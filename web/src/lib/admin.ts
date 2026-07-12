/** Admin = membership in the ADMIN_EMAILS env list. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  return admins.includes(email.toLowerCase())
}

export async function isAdmin(email: string | null | undefined): Promise<boolean> {
  return isAdminEmail(email)
}
