# Развёртывание и сдача

Опубликовано и проверено 20 ноября 2026 года: **[приложение](https://time-card-test-task.alwaysdata.net/)** и [исходники GitHub](https://github.com/spode-sleep/time-card-test-task). Аккаунт alwaysdata — `time-card-test-task`. Приведённые ниже `ACCOUNT` и URL-примеры используются для повторения развёртывания под своим аккаунтом.

## alwaysdata

По официальной документации, проверенной 20 ноября 2026 года, Free предоставляет 1 ГБ общего диска, 256 МБ RAM и адрес `ACCOUNT.alwaysdata.net`. Он подходит для личной демонстрации; собственный домен на Free недоступен. [Тарифы и ограничения](https://help.alwaysdata.com/en/admin-billing/billing/public-cloud-prices/).

Поддерживаются Node.js 24 и PostgreSQL 17. Проект использует обычный Node.js HTTP-сервер; Docker на публичном тарифе не требуется. Собирать клиент лучше локально и загружать готовый архив, чтобы не тратить память Free на TypeScript/Vite. [Настройка Node.js](https://help.alwaysdata.com/en/docs/web-hosting/languages/nodejs/configuration/), [PostgreSQL](https://help.alwaysdata.com/en/docs/web-hosting/databases/postgresql/).

1. Создать личный аккаунт [alwaysdata Free](https://www.alwaysdata.com/en/offers/), выбрать имя аккаунта и сохранить пароль у себя.
2. В панели Environment → Node.js выбрать 24. Проверить `node --version` и `npm --version`: нужны Node.js не ниже 24.22.1 в ветке 24 и npm 11. На аккаунте `time-card-test-task` проверен Node.js 24.22.1.
3. В Databases → PostgreSQL создать БД и пользователя. Взять фактические host, user и имя БД из панели. Обычно host — `postgresql-ACCOUNT.alwaysdata.net`, порт — 5432; имя БД имеет префикс аккаунта. Пароль в URL должен быть URL-encoded, если содержит специальные символы. Для TLS с проверкой сертификата и имени сервера добавить `?sslmode=verify-full` к строке подключения.
4. На машине со всеми исходниками установить в игнорируемом `.env` `DATABASE_URL` этой новой удалённой БД. Сохранить локальную конфигурацию отдельно, если она нужна. Выполнить:

   ```sh
   npm ci
   npm run build
   npm run db:migrate
   npm run db:seed:production
   npm run package:production
   ```

   Миграции применяются отдельной командой, не при каждом HTTP-запуске. Seed повторяемый, пользовательские смены не удаляет. Тесты с `CREATE DATABASE` запускать на локальном PostgreSQL, не на хостинге.

5. Архив `.release/time-card-production.tar.gz` содержит собранные backend, shared и frontend, manifests и инструкцию. `.env`, исходные снимки Figma и `node_modules` в него не входят. Рядом лежит SHA-256 для проверки передачи. Загрузить архив по SFTP или SCP:

   ```sh
   scp .release/time-card-production.tar.gz ACCOUNT@ssh-ACCOUNT.alwaysdata.net:~/
   ssh ACCOUNT@ssh-ACCOUNT.alwaysdata.net
   mkdir -p ~/time-card
   tar -xzf ~/time-card-production.tar.gz -C ~/time-card
   cd ~/time-card
   NODEJS_VERSION=24 npm ci --omit=dev --omit=peer --omit=optional --workspace @time-card/backend --workspace @time-card/shared --include-workspace-root=false --ignore-scripts
   ```

6. В Web → Sites создать сайт типа **Node.js** с адресом `ACCOUNT.alwaysdata.net`. Задать команду:

   ```sh
   node /home/ACCOUNT/time-card/backend/dist/server.js
   ```

   Переменные сайта: `NODEJS_VERSION=24`, `NODE_ENV=production`, `DATABASE_URL` из шага 3. Использовать IP/HOST и PORT, назначенные самим сайтом; приложение поддерживает `IP` как альтернативу `HOST`. Локальный `.env` с `HOST=127.0.0.1` на сервер не копировать. [Команда и адрес прослушивания](https://help.alwaysdata.com/en/docs/web-hosting/languages/nodejs/configuration/).

7. Включить перенаправление HTTP → HTTPS в настройках сайта. Для `*.alwaysdata.net` сертификат предоставляется хостингом. [Настройки сайта](https://help.alwaysdata.com/en/docs/web-hosting/sites/add-a-site/), [HTTPS и сертификаты](https://help.alwaysdata.com/en/docs/web-hosting/sites/ssl-tls/lets-encrypt/).
8. С локальной машины проверить:

   ```sh
   npm run check:deployment -- https://ACCOUNT.alwaysdata.net
   ```

   Затем в браузере назначить смену, сохранить, обновить страницу, создать конфликт двух вкладок и опубликовать. Проверить узкий экран. После перезапуска сайта убедиться, что сохранённая смена и статус публикации остались.

БД хранится в управляемом PostgreSQL и не зависит от перезапуска сайта. Free включает ежедневные резервные копии с хранением за 3 дня; для долгого хранения выгрузить отдельный `pg_dump`. [Резервные копии](https://help.alwaysdata.com/en/docs/web-hosting/backups/).

## Docker на своём сервере

Файл `compose.production.yaml` предназначен для машины с Docker, отдельно от alwaysdata Free. Он поднимает PostgreSQL с томом, однократный процесс миграции/seed и production-приложение. Development Vite, TypeScript и Prisma CLI в runtime-приложении не нужны.

```sh
cp .env.production.example .env.production
```

Задать случайный hex-пароль `POSTGRES_PASSWORD` в `.env.production`, например созданный `openssl rand -hex 32`. Такой пароль можно непосредственно использовать в URL подключения. Затем:

```sh
docker compose -p time-card-production --env-file .env.production -f compose.production.yaml up -d --build
docker compose -p time-card-production --env-file .env.production -f compose.production.yaml ps
npm run check:deployment -- http://127.0.0.1:3000
```

Порт приложения открыт только на loopback. На VPS перед ним нужен reverse proxy с HTTPS для выбранного домена. PostgreSQL наружу не публикуется. Миграции завершаются до старта приложения; healthcheck проверяет настоящий запрос в БД.

Для обновления повторить команду `up -d --build`. Для остановки использовать `stop` или `down` **без** `--volumes`, чтобы сохранить БД. Резервную копию можно снять через `pg_dump` внутри контейнера; на Windows перенаправлять бинарные дампы средствами, сохраняющими байты, или использовать текстовый SQL-формат.

## Проверки перед сдачей

```sh
npm run check
npm run test:frontend
npm run test:integration
npm run test:persistence
npm run test:production
npm audit
```

`test:production` создаёт чистую временную БД, применяет миграции, запускает собранный seed и отдельный процесс сервера из постороннего рабочего каталога. Проверяет HTML/JS/SVG/API, кэш, 404, сохранение, повтор, конфликт, публикацию и перезапуск. После проверки процесс и БД удаляются.

## GitHub и ссылки для работодателя

Локальные исходники можно опубликовать в новом пустом репозитории `time-card` своего аккаунта GitHub. В него входят приложение, SQL-миграции, lockfile, инструкции, тесты и снимки QA. `.env`, `node_modules`, сборки и архив выпуска исключены. Оригинальный `figma-assignment.html` сохранён локально, ссылка на исходный макет есть в README.

После создания пустого репозитория:

```sh
git remote add origin https://github.com/ACCOUNT/time-card.git
git push -u origin main
```

Перед отправкой работодателю должны быть две проверенные ссылки:

- HTTPS-адрес работающего приложения с доступным API и постоянной БД.
- Репозиторий GitHub с README и исходным кодом.

В публичном расписании использовать только демонстрационные данные: приложение реализует одно общее расписание без авторизации, как оговорено в рамках тестового задания.

## Результат опубликованной проверки

На реальном alwaysdata проверены Node.js 24.22.1 и npm 11.19.1. Установлены 105 runtime-пакетов; Vite, TypeScript и Prisma CLI в runtime отсутствуют. HTML, JS, шрифты, восемь SVG и API обслуживаются одним сайтом; PostgreSQL хранится отдельно от его процесса.

Через браузер сохранены шаблонные и ночная смены, проверены перезагрузка, конфликт двух вкладок, явный выбор решения и публикация. На 320×650 страница помещается по ширине, календарь прокручивается внутри своей области, мобильное меню работает. После перезапуска сайта назначений осталось `5`, ревизия и опубликованная версия — `4`; JS-файл совпадает с локальной сборкой. HTTP возвращает 301 на HTTPS. [Машинный отчёт](./qa-step-12/deployment-check.json).

Секреты не включены в исходники или архив. Данные для автоматической настройки хранятся в локальном игнорируемом `.env.deploy`; на сервере файл окружения имеет права `600`, а runtime-переменные сайта заданы в панели alwaysdata.
