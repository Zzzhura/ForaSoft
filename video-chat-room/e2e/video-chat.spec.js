import { test, expect } from '@playwright/test';

/**
 * E2E-сценарии видеочата (задача 24, TDD §11) на базе Acceptance Criteria из PRD.
 * Каждый участник — отдельный browser context (изолированные хранилище/доступы),
 * что соответствует «вкладка = отдельный участник/слот» (US-11).
 */

const ROOM_NAME = 'E2E Room';

/** Поднимает нового участника в изолированном контексте с fake-медиа. */
async function newParticipant(browser) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ['camera', 'microphone'],
  });
  const page = await context.newPage();
  return { context, page };
}

/** Создаёт комнату на стартовом экране и входит как `userName`; вернёт URL комнаты. */
async function createRoom(page, userName) {
  await page.goto('/');
  await page.getByPlaceholder('Введите название комнаты').fill(ROOM_NAME);
  await page.getByRole('button', { name: 'Создать комнату' }).click();
  await enterName(page, userName);
  await expect(page.locator('.tile')).toHaveCount(1);
  return page.url();
}

/** Открывает ссылку-приглашение и входит как `userName` (US-4). */
async function joinByLink(page, url, userName) {
  await page.goto(url);
  await enterName(page, userName);
}

/**
 * Форма входа в комнату: ввод имени + управление устройствами прямо в форме.
 * Камера и микрофон ВКЛЮЧЕНЫ по умолчанию (PRD п. 13). Для сценариев «без камеры»
 * (`camera: false`) выключаем её до входа; иначе дожидаемся готовности камеры.
 * @param {import('@playwright/test').Page} page
 * @param {string} userName
 * @param {{ camera?: boolean }} [opts]
 */
async function enterName(page, userName, { camera = true } = {}) {
  await page.getByPlaceholder('Введите ваше имя').fill(userName);
  if (camera) {
    await expect(page.getByRole('button', { name: 'Выключить камеру' })).toBeVisible();
  } else {
    await page.getByRole('button', { name: 'Выключить камеру' }).click();
    await expect(page.getByRole('button', { name: 'Включить камеру' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
}

/** Дожидается, пока в `<video>` пойдёт декодированный кадр (поток виден). */
async function expectVideoPlaying(locator) {
  await expect
    .poll(async () => locator.evaluate((v) => v.videoWidth), { timeout: 20_000 })
    .toBeGreaterThan(0);
}

test.describe('Видеочат-комната E2E', () => {
  test('US-4/US-6: вход по ссылке и видимость видеопотоков', async ({ browser }) => {
    const alice = await newParticipant(browser);
    const url = await createRoom(alice.page, 'Алиса');

    // Собственное видео воспроизводится (self-view).
    await expectVideoPlaying(alice.page.locator('.tile__video--self'));

    // Второй участник входит по ссылке.
    const bob = await newParticipant(browser);
    await joinByLink(bob.page, url, 'Боб');

    // У обоих появляется по 2 плитки.
    await expect(alice.page.locator('.tile')).toHaveCount(2);
    await expect(bob.page.locator('.tile')).toHaveCount(2);

    // Удалённый поток (Алисы) виден у Боба.
    await expectVideoPlaying(bob.page.locator('.tile__video:not(.tile__video--self)').first());

    // Имена участников выведены оверлеем (F-08).
    await expect(bob.page.locator('.tile__name', { hasText: 'Алиса' })).toBeVisible();

    await alice.context.close();
    await bob.context.close();
  });

  test('US-6: новичок без камеры видит видео участника с включённой камерой', async ({
    browser,
  }) => {
    const alice = await newParticipant(browser);
    await alice.page.goto('/');
    await alice.page.getByPlaceholder('Введите название комнаты').fill(ROOM_NAME);
    await alice.page.getByRole('button', { name: 'Создать комнату' }).click();
    await enterName(alice.page, 'Алиса', { camera: false });
    const url = alice.page.url();

    const bob = await newParticipant(browser);
    await bob.page.goto(url);
    await enterName(bob.page, 'Боб', { camera: true });

    // Алиса (камера off) должна видеть видео Боба (камера on).
    await expectVideoPlaying(alice.page.locator('.tile__video:not(.tile__video--self)').first());
    // Индикатор «камера выключена» — только на своей плитке Алисы; у Боба камера on.
    await expect(alice.page.getByLabel('Камера выключена')).toHaveCount(1);

    await alice.context.close();
    await bob.context.close();
  });

  test('US-6: камера, включённая уже в звонке, видна другому участнику (без чёрной плитки)', async ({
    browser,
  }) => {
    // Частый сценарий: оба входят с ВЫКЛЮЧЕННОЙ камерой (состояние по умолчанию),
    // соединение устанавливается на recvonly видео-трансивере, камера включается
    // позже — это переводит трансивер в sendrecv и запускает renegotiation
    // (perfect negotiation). Регрессия: первое видео не доезжало до удалённого
    // участника (replaceTrack на «холодном» m=video не начинал отправку) — чёрная плитка.
    const alice = await newParticipant(browser);
    await alice.page.goto('/');
    await alice.page.getByPlaceholder('Введите название комнаты').fill(ROOM_NAME);
    await alice.page.getByRole('button', { name: 'Создать комнату' }).click();
    await enterName(alice.page, 'Алиса', { camera: false });
    await expect(alice.page.locator('.tile')).toHaveCount(1);
    const url = alice.page.url();

    const bob = await newParticipant(browser);
    await bob.page.goto(url);
    await enterName(bob.page, 'Боб', { camera: false });
    await expect(bob.page.locator('.tile')).toHaveCount(2);

    // Алиса включает камеру уже в звонке.
    await alice.page.getByRole('button', { name: 'Включить камеру' }).click();
    await expect(alice.page.getByRole('button', { name: 'Выключить камеру' })).toBeVisible();

    // Видео Алисы доходит до Боба и реально проигрывается (videoWidth > 0).
    await expectVideoPlaying(bob.page.locator('.tile__video:not(.tile__video--self)').first());

    await alice.context.close();
    await bob.context.close();
  });

  test('US-8: чат в реальном времени', async ({ browser }) => {
    const alice = await newParticipant(browser);
    const url = await createRoom(alice.page, 'Алиса');
    const bob = await newParticipant(browser);
    await joinByLink(bob.page, url, 'Боб');
    await expect(bob.page.locator('.tile')).toHaveCount(2);

    await alice.page.getByPlaceholder('Написать сообщение…').fill('Привет, Боб!');
    await alice.page.getByRole('button', { name: 'Отправить' }).click();

    // Сообщение видно у обоих в реальном времени.
    await expect(bob.page.locator('.chat__text', { hasText: 'Привет, Боб!' })).toBeVisible();
    await expect(alice.page.locator('.chat__text', { hasText: 'Привет, Боб!' })).toBeVisible();
    // Имя отправителя в чате.
    await expect(bob.page.locator('.chat__author', { hasText: 'Алиса' })).toBeVisible();

    await alice.context.close();
    await bob.context.close();
  });

  test('US-7: индикатор выключенного микрофона', async ({ browser }) => {
    const alice = await newParticipant(browser);
    await createRoom(alice.page, 'Алиса');

    // Микрофон включён по умолчанию (PRD п. 13) → индикатора нет.
    await expect(alice.page.getByLabel('Микрофон выключен')).toHaveCount(0);

    // Выключаем микрофон — индикатор появляется (PRD п. 16).
    await alice.page.getByRole('button', { name: 'Выключить микрофон' }).click();
    await expect(alice.page.getByLabel('Микрофон выключен')).toBeVisible();

    // Снова включаем — индикатор исчезает.
    await alice.page.getByRole('button', { name: 'Включить микрофон' }).click();
    await expect(alice.page.getByLabel('Микрофон выключен')).toHaveCount(0);

    await alice.context.close();
  });

  test('US-5: пятый участник видит «Комната заполнена»', async ({ browser }) => {
    const owner = await newParticipant(browser);
    const url = await createRoom(owner.page, 'U0');

    const joined = [owner];
    for (let i = 1; i < 4; i += 1) {
      const p = await newParticipant(browser);
      await joinByLink(p.page, url, `U${i}`);
      await expect(p.page.locator('.tile')).toHaveCount(i + 1);
      joined.push(p);
    }

    // Пятый — отклоняется (F-05).
    const fifth = await newParticipant(browser);
    await joinByLink(fifth.page, url, 'Пятый');
    await expect(fifth.page.getByRole('heading', { name: 'Комната заполнена' })).toBeVisible();
    await expect(fifth.page.getByRole('button', { name: 'Повторить вход' })).toBeVisible();

    for (const p of [...joined, fifth]) {
      await p.context.close();
    }
  });

  test('US-10: выход участника — плитка исчезает, системное сообщение', async ({ browser }) => {
    const alice = await newParticipant(browser);
    const url = await createRoom(alice.page, 'Алиса');
    const bob = await newParticipant(browser);
    await joinByLink(bob.page, url, 'Боб');
    await expect(bob.page.locator('.tile')).toHaveCount(2);

    // Алиса нажимает «Выйти».
    await alice.page.getByRole('button', { name: 'Выйти из комнаты' }).click();

    // У Боба её плитка исчезает и приходит системное сообщение (F-17/F-15).
    await expect(bob.page.locator('.tile')).toHaveCount(1);
    await expect(bob.page.locator('.chat__system', { hasText: 'покинул комнату' })).toBeVisible();

    await alice.context.close();
    await bob.context.close();
  });

  test('US-11: обрыв (закрытие вкладки) — остальные продолжают звонок', async ({ browser }) => {
    const alice = await newParticipant(browser);
    const url = await createRoom(alice.page, 'Алиса');
    const bob = await newParticipant(browser);
    await joinByLink(bob.page, url, 'Боб');
    await expect(alice.page.locator('.tile')).toHaveCount(2);

    // Боб закрывает вкладку — приравнивается к выходу (US-11).
    await bob.context.close();

    await expect(alice.page.locator('.tile')).toHaveCount(1);
    await expect(alice.page.locator('.chat__system', { hasText: 'покинул комнату' })).toBeVisible();

    await alice.context.close();
  });
});
