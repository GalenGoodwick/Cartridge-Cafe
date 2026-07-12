import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Get admin user (you)
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { contains: 'galen' } },
        { email: { contains: 'goodwick' } }
      ]
    }
  })

  if (!user) {
    console.log('User not found')
    return
  }

  console.log('Found user:', user.email)

  // Create deliberation
  const delib = await prisma.deliberation.create({
    data: {
      question: 'Manual Test: What is the best pizza topping?',
      description: 'Testing the vote UI',
      phase: 'VOTING',
      currentTier: 1,
      isPublic: true,
      creatorId: user.id,
      allocationMode: 'balanced',
      continuousFlow: false,
      allowAI: false,
    }
  })

  console.log('Created deliberation:', delib.id)

  // Add you as participant
  await prisma.deliberationMember.create({
    data: {
      deliberationId: delib.id,
      userId: user.id,
      role: 'PARTICIPANT'
    }
  })

  // Create test users
  const testUsers = []
  for (let i = 0; i < 4; i++) {
    const testUser = await prisma.user.upsert({
      where: { email: `manual-test-${i}@test.com` },
      create: {
        email: `manual-test-${i}@test.com`,
        name: `Test User ${i+1}`,
        emailVerified: new Date(),
        status: 'ACTIVE'
      },
      update: {}
    })
    testUsers.push(testUser)

    await prisma.deliberationMember.create({
      data: {
        deliberationId: delib.id,
        userId: testUser.id,
        role: 'PARTICIPANT'
      }
    })
  }

  // Create 5 ideas
  const toppings = ['Pepperoni', 'Mushrooms', 'Sausage', 'Onions', 'Peppers']
  const ideas = []
  for (let i = 0; i < 5; i++) {
    const idea = await prisma.idea.create({
      data: {
        deliberationId: delib.id,
        authorId: testUsers[i % 4].id,
        text: `${toppings[i]} - the classic choice`,
        status: 'IN_VOTING',
        tier: 1
      }
    })
    ideas.push(idea)
  }

  console.log('Created 5 ideas')

  // Create a cell with you and 4 test users
  const cell = await prisma.cell.create({
    data: {
      deliberationId: delib.id,
      tier: 1,
      status: 'VOTING',
      votingEndsAt: new Date(Date.now() + 3600000) // 1 hour from now
    }
  })

  console.log('Created cell:', cell.id)

  // Add all 5 participants to the cell
  const allParticipants = [user, ...testUsers]
  for (const participant of allParticipants) {
    await prisma.cellParticipant.create({
      data: {
        cellId: cell.id,
        userId: participant.id
      }
    })
  }

  // Add all 5 ideas to the cell
  for (const idea of ideas) {
    await prisma.cellIdea.create({
      data: {
        cellId: cell.id,
        ideaId: idea.id
      }
    })
  }

  console.log('✅ Done!')
  console.log('Chant ID:', delib.id)
  console.log('Visit: http://localhost:3001/chants')
  console.log('You should now see it in the Vote tab!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
