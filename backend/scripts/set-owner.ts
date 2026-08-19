/**
 * Changes an account's email or name, and can promote it to OWNER.
 *
 *   npm run set:owner -- --from old@example.com --to new@example.com
 *   npm run set:owner -- --to new@example.com --name "Muhammad Abdullah"
 *
 * Exists because the first account is created during registration and there is
 * no profile-editing screen yet. Run it, then sign in with the NEW email and
 * the SAME password.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const prisma = new PrismaClient();
  const to = arg('to');
  const from = arg('from');
  const name = arg('name');

  if (!to) {
    console.error('Usage: npm run set:owner -- --to new@email.com [--from old@email.com] [--name "Full Name"]');
    process.exit(1);
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  if (!users.length) {
    console.error('No accounts exist yet. Register one in the app first.');
    process.exit(1);
  }

  console.log('Existing accounts:');
  for (const u of users) console.log(`  ${u.email}  (${u.role})  ${u.name}`);
  console.log('');

  // If the target email already has an account, promote THAT one rather than
  // renaming another into a collision. This is the common real case: you
  // registered a second time with the address you actually wanted.
  const existingTarget = users.find((u) => u.email === to.toLowerCase());

  const target = existingTarget
    ? existingTarget
    : from
      ? users.find((u) => u.email === from.toLowerCase())
      : // Default to the oldest account - the one registration made OWNER.
        users[0];

  if (!target) {
    console.error(`No account found with email ${from}`);
    process.exit(1);
  }

  if (existingTarget) {
    console.log(`${to} already exists (${existingTarget.role}) - promoting it to OWNER.`);
  }

  // Optionally delete another account, e.g. one created with the wrong address.
  const remove = arg('remove');
  if (remove) {
    const victim = users.find((u) => u.email === remove.toLowerCase());
    if (!victim) {
      console.error(`Cannot remove ${remove}: no such account.`);
      process.exit(1);
    }
    if (victim.id === target.id) {
      console.error('Refusing to remove the account you are promoting.');
      process.exit(1);
    }
    // Runs and tickets reference users optionally, so deleting is safe - the
    // work stays, it just loses its creator/assignee link.
    await prisma.loginSession.deleteMany({ where: { userId: victim.id } });
    await prisma.ticket.updateMany({
      where: { assigneeId: victim.id },
      data: { assigneeId: null },
    });
    await prisma.ticket.updateMany({
      where: { reporterId: victim.id },
      data: { reporterId: target.id },
    });
    await prisma.ticketComment.updateMany({
      where: { authorId: victim.id },
      data: { authorId: target.id },
    });
    await prisma.run.updateMany({
      where: { createdById: victim.id },
      data: { createdById: target.id },
    });
    await prisma.user.delete({ where: { id: victim.id } });
    console.log(`Removed account ${victim.email}. Its tickets and runs now belong to ${to}.`);
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      email: to.trim().toLowerCase(),
      name: name?.trim() ?? undefined,
      role: 'OWNER',
    },
    select: { email: true, name: true, role: true },
  });

  console.log(`Updated: ${target.email} -> ${updated.email}`);
  console.log(`Name:    ${updated.name}`);
  console.log(`Role:    ${updated.role}`);
  console.log('');
  console.log('Your password is unchanged. Sign in with the new email.');
  console.log('Existing sessions are revoked, so sign in again.');

  // The old email is baked into issued tokens, so old sessions must go.
  await prisma.loginSession.updateMany({
    where: { userId: target.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await prisma.$disconnect();
}

void main().catch(async (err) => {
  console.error('FAILED:', (err as Error).message);
  process.exit(1);
});
