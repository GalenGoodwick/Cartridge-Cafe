import { NextAuthOptions } from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import GoogleProvider from 'next-auth/providers/google'
import GitHubProvider from 'next-auth/providers/github'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
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

        if (!user || !user.passwordHash) return null
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
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async signIn({ user, account }) {
      // Skip status check for credentials (already handled in authorize)
      if (account?.provider === 'credentials') return true

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

        // Check if this is a temp anonymous account (no challenge passed)
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
        })
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
