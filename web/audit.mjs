import pkg from '@next/env'; pkg.loadEnvConfig(process.cwd())
const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const { Pool } = await import('pg')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
// 1) main space snapshot: pristine or gnats?
const root = await prisma.playerSpace.findUnique({ where:{ slug:'smug-world' }, select:{ snapshot:true, updatedAt:true } })
const rw=(root.snapshot?.visualTypes||[]).find(v=>v.name==='smug_planet')?.wgsl||''
console.log('MAIN smug-world: gnats?', /the gnats|smash pops|uni\(8\)/.test(rw), '| hook author:', (root.snapshot?.stepHooks||[{}])[0]?.author, '| updated:', root.updatedAt.toISOString())
// 2) any fork spaces of smug-world?
const forks = await prisma.playerSpace.findMany({ where:{ forkOfId: 'cmrjl4tgb0000ozufxkcaqt6q' }, select:{slug:true,name:true} })
console.log('fork spaces of smug-world:', JSON.stringify(forks))
// 3) space tokens on smug-world
const toks = await prisma.spaceToken.findMany({ where:{ space:{ slug:'smug-world' }, revokedAt:null }, select:{ name:true, tokenPrefix:true, lastUsedAt:true } })
console.log('active space tokens on smug-world:', JSON.stringify(toks))
await prisma.$disconnect(); await pool.end()
