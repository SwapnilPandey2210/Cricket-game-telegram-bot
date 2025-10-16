import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Find SP user and make them an admin
  const spUser = await prisma.user.findFirst({
    where: { firstName: 'SP' }
  })

  if (!spUser) {
    console.log('SP user not found. They need to interact with the bot first.')
    return
  }

  // Update the user to be an admin
  await prisma.user.update({
    where: { id: spUser.id },
    data: { isAdmin: true }
  })

  console.log('SP is now set as an admin')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })