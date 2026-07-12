const fs = require('fs');
const envFile = fs.readFileSync('/Users/galengoodwick/Documents/GitHub/unionchant/web/.env.local', 'utf8');
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
});
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const children = await prisma.shell.findMany({
    where: { status: 'active', originDeliberationId: { not: null } },
    select: { id: true, name: true, champion: true, bondedUserId: true, ownerId: true }
  });
  console.log('CHILDREN (' + children.length + '):');
  children.forEach(c => {
    console.log('  ' + c.name);
    console.log('    ownerId: ' + c.ownerId);
    console.log('    bonded: ' + (c.bondedUserId ? 'yes' : 'no'));
    console.log('    champion: ' + (c.champion || '').slice(0, 100));
  });

  const chantId = 'cmly62z88000004juurxnnfiq';
  const ideas = await prisma.idea.findMany({
    where: { deliberationId: chantId },
    select: { id: true, text: true, authorId: true },
  });
  console.log('\nIDEAS SO FAR: ' + ideas.length);
  ideas.forEach(i => console.log('  - ' + i.text.slice(0, 140)));

  const parts = await prisma.deliberationParticipant.findMany({
    where: { deliberationId: chantId },
    select: { userId: true }
  });
  console.log('PARTICIPANTS: ' + parts.length);

  // Check if any AIAgents exist that could also participate
  const aiAgentCount = await prisma.aIAgent.count({ where: { isDeployed: true } });
  console.log('\nDEPLOYED AI AGENTS: ' + aiAgentCount);

  await prisma.$disconnect();
  pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
