import { NextAuthOptions } from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import GoogleProvider from 'next-auth/providers/google'
import GitHubProvider from 'next-auth/providers/github'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { verifyChallengeCookie, CHALLENGE_COOKIE } from './passkeys'
import prisma from './prisma'
import { checkRateLimit } from './rate-limit'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  providers: [
    // Google OAuth
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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

    // Email/password credentials
    CredentialsProvider({
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null


        // Rate limit login attempts by email (10/min)
        const rateLimited = await checkRateLimit('login', credentials.email)
        if (rateLimited) return null

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          select: { id: true, email: true, name: true, image: true, passwordHash: true, status: true },
        })

        // A NEW name signs the ledger: an unknown email + a word CREATES the
        // account right here (there was no signup door at all — a fresh email
        // just bounced with "did not match"). 8+ chars keeps the word a word.
        if (!user) {
          if (credentials.password.length < 8) return null
          const passwordHash = await bcrypt.hash(credentials.password, 12)
          const created = await prisma.user.create({
            data: {
              email: credentials.email,
              name: credentials.email.split('@')[0],
              passwordHash,
            },
            select: { id: true, email: true, name: true, image: true },
          })
          return created
        }
        // The email exists but came in through another door (OAuth — no
        // password on file). Refuse: typing a password here must never
        // claim someone's Google-born account.
        if (!user.passwordHash) return null
        if (user.status === 'BANNED') return null

        const valid = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!valid) return null

        // Reactivate self-deleted accounts on login
        if (user.status === 'DELETED') {
          await prisma.user.update({
            where: { id: user.id },
            data: { status: 'ACTIVE', deletedAt: null },
          })
        }

        return { id: user.id, email: user.email, name: user.name, image: user.image }
      },
    }),

    // Passkey (WebAuthn) — device-bound sign-in. The browser gets options from
    // /api/auth/passkey/login, the authenticator signs, and the assertion is
    // verified here against the stored public key. No password ever exists.
    CredentialsProvider({
      id: 'passkey',
      name: 'Passkey',
      credentials: { assertion: { label: 'Assertion', type: 'text' } },
      async authorize(credentials, req) {
        if (!credentials?.assertion) return null
        let assertion: { id?: string; rawId?: string }
        try { assertion = JSON.parse(credentials.assertion) } catch { return null }
        if (!assertion?.id) return null

        // the challenge rides the signed cookie set by the options route
        const cookieHeader = (req?.headers as Record<string, string> | undefined)?.cookie || ''
        const raw = cookieHeader.split('; ').find(c => c.startsWith(CHALLENGE_COOKIE + '='))?.slice(CHALLENGE_COOKIE.length + 1)
        const expectedChallenge = verifyChallengeCookie(raw ? decodeURIComponent(raw) : undefined)
        if (!expectedChallenge) return null

        const passkey = await prisma.passkey.findUnique({
          where: { credentialId: assertion.id },
          include: { user: { select: { id: true, email: true, name: true, image: true, status: true } } },
        })
        if (!passkey || passkey.user.status === 'BANNED') return null

        const host = (req?.headers as Record<string, string> | undefined)?.host || 'localhost:3000'
        const rpID = host.split(':')[0]
        const origin = `${rpID === 'localhost' ? 'http' : 'https'}://${host}`
        try {
          const { verified, authenticationInfo } = await verifyAuthenticationResponse({
            response: assertion as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
            expectedChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: {
              id: passkey.credentialId,
              publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')),
              counter: passkey.counter,
            },
          })
          if (!verified) return null
          await prisma.passkey.update({
            where: { id: passkey.id },
            data: { counter: authenticationInfo.newCounter, lastUsedAt: new Date() },
          })
          if (passkey.user.status === 'DELETED') {
            await prisma.user.update({ where: { id: passkey.user.id }, data: { status: 'ACTIVE', deletedAt: null } })
          }
          return { id: passkey.user.id, email: passkey.user.email, name: passkey.user.name, image: passkey.user.image }
        } catch {
          return null
        }
      },
    }),

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
      // Skip status check for credentials (already handled in authorize)
      if (account?.provider === 'credentials' || account?.provider === 'passkey' || account?.provider === 'guest') return true

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
