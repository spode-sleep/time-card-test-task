import { prisma } from './prisma.js';
import { database } from './database.js';

const employees = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    fullName: 'Кузнецова Алина',
    sortOrder: 0,
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    fullName: 'Волков Тимур',
    sortOrder: 1,
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    fullName: 'Морозова Виктория',
    sortOrder: 2,
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    fullName: 'Соколов Артём',
    sortOrder: 3,
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    fullName: 'Лебедева Полина',
    sortOrder: 4,
  },
  {
    id: '10000000-0000-4000-8000-000000000006',
    fullName: 'Новиков Кирилл',
    sortOrder: 5,
  },
  {
    id: '10000000-0000-4000-8000-000000000007',
    fullName: 'Ерохина Дарья',
    sortOrder: 6,
  },
  {
    id: '10000000-0000-4000-8000-000000000008',
    fullName: 'Гаврилов Егор',
    sortOrder: 7,
  },
];

const templates = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    code: 'morning',
    name: 'Утро',
    startMinute: 7 * 60,
    endMinute: 15 * 60,
    endDayOffset: 0,
    color: '#E8ECFF',
    sortOrder: 0,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    code: 'day',
    name: 'День',
    startMinute: 10 * 60,
    endMinute: 18 * 60,
    endDayOffset: 0,
    color: '#E9DFFF',
    sortOrder: 1,
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    code: 'evening',
    name: 'Вечер',
    startMinute: 15 * 60,
    endMinute: 23 * 60,
    endDayOffset: 0,
    color: '#DDF7F5',
    sortOrder: 2,
  },
];

try {
  await prisma.$transaction([
    prisma.schedule.createMany({ data: [{ id: 1 }], skipDuplicates: true }),
    prisma.employee.createMany({
      data: employees.map((employee, index) => ({
        ...employee,
        position: 'агент',
        avatarUrl: `/avatars/employee-${index + 1}.svg`,
      })),
      skipDuplicates: true,
    }),
    ...employees.map((employee, index) =>
      prisma.employee.updateMany({
        where: {
          id: employee.id,
          OR: [
            { avatarUrl: null },
            { avatarUrl: `/avatars/employee-${index + 1}.png` },
          ],
        },
        data: { avatarUrl: `/avatars/employee-${index + 1}.svg` },
      }),
    ),
    prisma.shiftTemplate.createMany({ data: templates, skipDuplicates: true }),
  ]);

  console.log('Demo employees, shift templates and schedule initialized.');
} catch (error) {
  console.error('Demo data initialization failed', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  await database.end();
}
