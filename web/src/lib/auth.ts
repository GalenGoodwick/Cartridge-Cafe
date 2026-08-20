import { NextAuthOptions } from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import GoogleProvider from 'next-auth/providers/google'
import GitHubProvider from 'next-auth/providers/github'
import prisma from './prisma'

// ── Auth diagnostics (env-gated) ────────────────────────────────────────────
// Set AUTH_DEBUG=1 on the environment to instrument the OAuth GET callback path.
// A failed GitHub sign-in otherwise bounces silently to /auth/signin with no
// server trace. With this on, the exact failure leaves a greppable breadcrumb in
// the Vercel function logs. SAFE: errors are always logged but REDACTED; verbose
// warn/debug only when AUTH_DEBUG=1; never logs tokens, auth codes, or full
// emails. Off by default — deploying this changes nothing until the flag is set.
const AUTH_DEBUG = process.env.AUTH_DEBUG === '1'
const redactEmail = (e?: string | null) =>
  !e ? String(e) : e.replace(/^(.{2}).*(@.*)$/, '$1***$2')
const safeMeta = (m: unknown): unknown => {
  if (m instanceof Error) return { name: m.name, message: m.message }
  if (m && typeof m === 'object') {
    const o = m as Record<string, unknown>
    return { provider: o.provider ?? o.providerId, message: (o.error as Error)?.message ?? o.message }
  }
  return m
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  debug: AUTH_DEBUG,
  logger: {
    // The failure point: OAuthAccountNotLinked (thrown BEFORE the signIn callback),
    // OAuthCallback, and adapter createUser/linkAccount errors all surface here.
    error(code, metadata) {
      console.error('[auth][ERROR]', code, JSON.stringify(safeMeta(metadata)))
    },
    warn(code) { if (AUTH_DEBUG) console.warn('[auth][warn]', code) },
    debug(code) { if (AUTH_DEBUG) console.log('[auth][debug]', code) },
  },
  events: {
    // Which sub-steps actually fired. On an OAuthAccountNotLinked refusal, NONE of
    // createUser/linkAccount fire but logger.error does — that combination is the
    // signature of the linking bug. A createUser error with no createUser event =
    // the null-email path. A signIn event = the login completed.
    async signIn({ user, account, isNewUser }) {
      console.log('[auth][signIn]', JSON.stringify({ provider: account?.provider, isNewUser: !!isNewUser, email: redactEmail(user?.email) }))
    },
    async createUser({ user }) {
      console.log('[auth][createUser]', JSON.stringify({ email: redactEmail(user?.email), hasEmail: !!user?.email }))
    },
    async linkAccount({ account, user }) {
      console.log('[auth][linkAccount]', JSON.stringify({ provider: account?.provider, email: redactEmail(user?.email) }))
    },
  },
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
            // GitHub now sends the RFC 9207 `iss` parameter on OAuth callbacks.
            // openid-client then REQUIRES the client's issuer to be declared and
            // to match — next-auth v4 builds GitHub's client without one, so every
            // callback died with "issuer must be configured on the issuer"
            // (= the intermittent GitHub login failure; Google is immune because
            // OIDC discovery sets its issuer). GitHub's actual iss value, captured
            // live from a prod callback: https://github.com/login/oauth — NOT the
            // bare domain. Reproduced + fix verified by replaying the callback
            // with a minted state cookie ± iss.
            issuer: 'https://github.com/login/oauth',
            // Mirror Google (the primary door): route a GitHub login into the existing
            // same-email account instead of refusing with OAuthAccountNotLinked.
            // Landed only AFTER the GitHub flow was verified live end-to-end (a real
            // sign-in completed on the fixed issuer). Safe: the provider fetches the
            // account's PRIMARY VERIFIED email (scope user:email → /user/emails), so
            // it can't hijack an address the person doesn't control. Email is the one
            // universal routing key across both doors.
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),

  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async signIn({ user, account }) {
      // Check if user is banned (deleted users can reactivate by logging in)
      try {
        if (user?.email) {
          const dbUser = await prisma.user.findUnique({
            where: { email: user.email },
            select: { id: true, status: true },
          })
          if (AUTH_DEBUG) console.log('[auth][signIn:cb]', JSON.stringify({ provider: account?.provider, hasEmail: !!user?.email, existingUser: !!dbUser, status: dbUser?.status ?? null }))
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
      }
      return session
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id
        token.sub = user.id
        if (user.image) token.picture = user.image
        if (user.name) token.name = user.name
      }

      // When session is updated (e.g. onboarding name change, account upgrade), persist to token
      if (trigger === 'update' && session) {
        if (session.name) token.name = session.name
        if (session.image) token.picture = session.image
      }
      return token
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
}
