import { NextAuthOptions } from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import GoogleProvider from 'next-auth/providers/google'
import GitHubProvider from 'next-auth/providers/github'
import CredentialsProvider from 'next-auth/providers/credentials'
import prisma from './prisma'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  providers: [
    // Google OAuth
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            // Link a Google login to an existing same-email user instead of failing
            // with OAuthAccountNotLinked. Safe here: Google verifies the email, so it
            // can't be used to hijack an account under an address you don't control.
            // (Fixes pre-existing cafe users — e.g. accounts carried from the shared
            // dawn-base — being walled out when they first sign in with Google.)
            allowDangerousEmailAccountLinking: true,
            // Always show Google's account chooser, so a returning user can pick
            // WHICH Google account (default silently reuses the one browser session
            // — "no ability to choose account").
            authorization: { params: { prompt: 'select_account' } },
          }),
        ]
      : []),

    // GitHub OAuth
    ...(process.env.GITHUB_ID && process.env.GITHUB_SECRET
      ? [
          GitHubProvider({
            clientId: process.env.GITHUB_ID,
            clientSecret: process.env.GITHUB_SECRET,
          }),
        ]
      : []),

    // Guest — one world, no account. /api/auth/guest mints a temp user and a
    // signed httpOnly cookie; this provider turns that cookie into a session.
    // When the guest later signs in through a REAL door, /api/spaces/claim
    // moves their world onto the new account (ownership follows the person).
    CredentialsProvider({
      id: 'guest',
      name: 'Guest',
      credentials: {},
      async authorize(_credentials, req) {
        const cookieHeader = (req?.headers as Record<string, string> | undefined)?.cookie || ''
        const raw = cookieHeader.split('; ').find(c => c.startsWith('cc_guest='))?.slice(9)
        if (!raw) return null
        const { verifyChallengeCookie } = await import('./passkeys')
        const guestId = verifyChallengeCookie(decodeURIComponent(raw))
        if (!guestId) return null
        const user = await prisma.user.findUnique({ where: { id: guestId } })
        if (!user || user.status !== 'ACTIVE' || !user.email.endsWith('@guest.cartridge.cafe')) return null
        return { id: user.id, email: user.email, name: user.name, isTemp: true } as { id: string; email: string; name: string | null; isTemp: boolean }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async signIn({ user, account }) {
      // Skip status check for the guest door (already handled in authorize)
      if (account?.provider === 'guest') return true

      // Check if user is banned (deleted users can reactivate by logging in)
      try {
        if (user?.email) {
          const dbUser = await prisma.user.findUnique({
            where: { email: user.email },
            select: { id: true, status: true },
          })
          if (dbUser?.status === 'BANNED') {
            return false
          }
          // Reactivate self-deleted accounts on OAuth login
          if (dbUser?.status === 'DELETED') {
            await prisma.user.update({
              where: { id: dbUser.id },
              data: { status: 'ACTIVE', deletedAt: null },
            })
          }
        }
      } catch (error) {
        console.error('Error checking user status:', error)
      }
      return true
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.sub || token.id) as string
        if (token.picture) session.user.image = token.picture as string
        if (token.name) session.user.name = token.name as string
        if (token.isTemp) session.user.isTemp = true
      }
      return session
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id
        token.sub = user.id
        if (user.image) token.picture = user.image
        if (user.name) token.name = user.name
        if ((user as { isTemp?: boolean }).isTemp) token.isTemp = true
      }

      // When session is updated (e.g. onboarding name change, account upgrade), persist to token
      if (trigger === 'update' && session) {
        if (session.name) token.name = session.name
        if (session.image) token.picture = session.image
        // Allow clearing isTemp when account is upgraded
        if (session.isTemp === false) token.isTemp = false
      }
      return token
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
}
