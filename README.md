# Orbit

**Orbit — твой корпоративный аккаунт, сервисы и подключения в одном месте.**

Персональный портал сотрудника поверх Keycloak: профиль, аватар, каталог корпоративных сервисов с переходом по SSO, настройки безопасности и минимальная административная панель. Keycloak остаётся единственным Identity Provider: Orbit не хранит пароли и не реализует собственную аутентификацию.

Стек: **Go** (API, BFF) + **React / TypeScript** (Vite) + **PostgreSQL** + **Keycloak 26**; аватары — локальная ФС или S3-совместимое хранилище.

## Архитектура

```
Браузер ──(cookie сессии, CSRF-токен)──► Orbit API (Go) ──OIDC + PKCE──► Keycloak
   │                                       │   └─ Admin REST API (service account)
   └─ React SPA (статикой из Go или Vite)  ├─► PostgreSQL: каталог, избранное, аватары, сессии, аудит
                                           └─► Avatar storage: ФС или S3
```

- **Backend-for-frontend.** Authorization Code Flow + PKCE выполняет бэкенд как confidential client. Токены Keycloak хранятся только на сервере (в таблице `sessions`, зашифрованы AES-256-GCM), браузер получает лишь непрозрачный `HttpOnly` cookie. Проверяются подпись, issuer, audience, срок действия и nonce ID-токена; access-токен обновляется по refresh-токену, а отказ Keycloak (сессия завершена, пользователь отключён) завершает и сессию Orbit.
- **Пользователь** идентифицируется по `sub` из OIDC, а не по email.
- **Профиль** читается и меняется через Admin REST API Keycloak от имени отдельного service account `orbit-admin-api` с ролями `view-users` и `manage-users`. Редактировать можно только имя, фамилию и атрибуты из `ORBIT_EDITABLE_ATTRIBUTES`; email, логин и прочие поля — нет.
- **Аватар.** Источник истины — Orbit (метаданные в PostgreSQL, файл в storage), а не атрибуты Keycloak. Файл проверяется по содержимому (PNG/JPEG/WebP, 64–4096 px, лимит размера), обрезается до квадрата и **перекодируется** в изображение не больше 512×512 — это убирает EXIF и всё, что приклеено к файлу. URL публикуется в стандартный атрибут `picture`, поэтому другие SSO-приложения получают его в claim `picture`.
- **Каталог.** Доступность сервиса решает сервер: статус (`active` / `maintenance` / `hidden`) и список ролей realm (пусто — всем). Переход идёт через `/go/{slug}`: сервер ещё раз проверяет доступ, пишет событие в аудит и делает редирект; приложение авторизует пользователя тем же Keycloak, поэтому повторного входа нет (SSO).
- **Безопасность** — смена пароля, OTP и WebAuthn через [application-initiated actions](https://www.keycloak.org/docs/latest/server_development/#_aia) (`kc_action`): Keycloak сам просит повторно подтвердить вход и возвращает пользователя в Orbit. Сессии, устройства и связанные аккаунты — ссылки в Account Console Keycloak.
- **Аудит:** вход/выход, изменения профиля (только имена полей), аватар, переходы в сервисы, действия администратора.

### Принятые решения по открытым вопросам (§12 плана)

| Вопрос | Решение в MVP |
|---|---|
| Frontend / backend / СУБД | React + TS (Vite), Go (chi, go-oidc, pgx), PostgreSQL 17 |
| Хранение аватаров | ФС для разработки, S3-совместимое (MinIO, Ceph, AWS) для продакшена |
| Realm | Один realm (`ORBIT_KEYCLOAK_REALM`) |
| Кто управляет каталогом | Пользователи с ролью `orbit-admin` (`ORBIT_ADMIN_ROLE`) |
| Редактируемые поля | Имя, фамилия и `ORBIT_EDITABLE_ATTRIBUTES` (по умолчанию `phoneNumber,jobTitle`); `ORBIT_VISIBLE_ATTRIBUTES` только для чтения |
| Регистрация | Выключена; приглашения — следующий этап |
| Пользовательские интеграции | Не в MVP; связанные IdP и выданные разрешения — через Account Console |

## Быстрый старт

Нужны Docker, Go 1.27+, Node.js 22+.

```bash
make infra   # PostgreSQL :5432 и Keycloak :8081 с импортом realm "orbit"
```

```bash
make api     # Go API на :8080 (создаст backend/.env из .env.example)
```

```bash
make web     # Vite на :5173, проксирует /api, /auth и /go на :8080
```

Откройте http://localhost:5173 и войдите:

| Логин / пароль | Роли |
|---|---|
| `alice` / `alice` | `orbit-admin`, `employee`, `developer` — видит админку и все сервисы |
| `bob` / `bob` | `employee` — видит только общедоступные сервисы |

Консоль Keycloak: http://localhost:8081 (`admin` / `admin`).

Всё в контейнерах, одним образом (SPA отдаёт Go): `docker compose --profile app up -d --build`, затем http://localhost:8080.

## Конфигурация

Все параметры — переменные окружения (полный список в [backend/.env.example](backend/.env.example) и [config.go](backend/internal/config/config.go)).

| Переменная | Назначение |
|---|---|
| `ORBIT_PUBLIC_URL` | Origin, по которому браузер открывает Orbit; из него строится redirect URI и проверяется `Origin` |
| `ORBIT_DATABASE_URL` | Строка подключения PostgreSQL; миграции применяются при старте |
| `ORBIT_SESSION_SECRET` | ≥ 32 символов, ключ шифрования сессий и OAuth state |
| `ORBIT_SESSION_TTL` | Максимальная длительность сессии Orbit (по умолчанию `12h`) |
| `ORBIT_KEYCLOAK_URL`, `ORBIT_KEYCLOAK_REALM` | Публичный адрес Keycloak и realm (issuer = `URL/realms/REALM`) |
| `ORBIT_KEYCLOAK_INTERNAL_URL` | Необязательный внутренний адрес Keycloak для бэкенда (например, в docker-сети) |
| `ORBIT_OIDC_CLIENT_ID/SECRET` | Confidential client для входа пользователей |
| `ORBIT_KEYCLOAK_ADMIN_CLIENT_ID/SECRET` | Service account для Admin REST API |
| `ORBIT_ADMIN_ROLE` | Роль realm с доступом к админке |
| `ORBIT_EDITABLE_ATTRIBUTES` / `ORBIT_VISIBLE_ATTRIBUTES` | Атрибуты профиля, редактируемые / только видимые пользователю |
| `ORBIT_STORAGE_DRIVER` | `fs` или `s3` (+ `ORBIT_S3_*`) |
| `ORBIT_AVATAR_MAX_BYTES` | Лимит размера загружаемого файла (по умолчанию 5 МБ) |
| `ORBIT_COOKIE_SECURE` | По умолчанию `true`, если `ORBIT_PUBLIC_URL` на https |
| `ORBIT_TRUST_PROXY` | Брать IP клиента из `X-Forwarded-For` (только за доверенным прокси) |
| `ORBIT_STATIC_DIR` | Каталог собранного фронтенда; Go отдаёт SPA с fallback на `index.html` |
| `ORBIT_SEED_DEMO` | Заполнить пустой каталог демо-сервисами |

### Настройка Keycloak для своего окружения

Готовый пример — [deploy/keycloak/orbit-realm.json](deploy/keycloak/orbit-realm.json). Если подключаете существующий realm:

1. Клиент `orbit-web`: confidential, только Standard Flow, PKCE `S256`, redirect URI `https://<orbit>/auth/callback`, post-logout redirect URI `https://<orbit>/`.
2. В клиент `orbit-web` добавить мапперы: *User Realm Role* → claim `roles`, *Group Membership* → claim `groups` (оба в ID token).
3. Клиент `orbit-admin-api`: только service account; роли `realm-management`: `view-users`, `manage-users`.
4. В User Profile объявить атрибуты `phoneNumber`, `jobTitle` (редактирует пользователь), `department`, `picture` (редактирует только admin). Атрибуты, не объявленные в профиле, Keycloak молча отбрасывает.

## API

| Метод и путь | Описание |
|---|---|
| `GET /auth/login?return_to=` | Начать вход (PKCE, state, nonce в зашифрованном cookie) |
| `GET /auth/callback` | Возврат из Keycloak, создание сессии |
| `GET /auth/action/{UPDATE_PASSWORD\|CONFIGURE_TOTP\|webauthn-register}` | Действие в Keycloak с возвратом на `/security` |
| `POST /auth/logout` | Завершить сессию; ответ содержит URL выхода из Keycloak |
| `GET /go/{slug}` | Переход в сервис с проверкой доступа и аудитом |
| `GET /api/config` | Публичные настройки (ссылки на Account Console) |
| `GET /api/me` | Текущий пользователь и CSRF-токен |
| `GET`, `PATCH /api/profile` | Профиль из Keycloak / изменение разрешённых полей |
| `PUT`, `DELETE /api/profile/avatar` | Загрузка (`multipart/form-data`, поле `file`) / удаление аватара |
| `GET /api/users/{sub}/avatar` | Аватар пользователя (публично, для claim `picture`) |
| `GET /api/services` | Доступные пользователю сервисы и категории |
| `PUT /api/services/{id}/favorite` | `{"favorite": true}` |
| `GET`, `POST /api/admin/services`, `PUT`, `DELETE /api/admin/services/{id}` | Управление каталогом (`orbit-admin`) |
| `GET /api/admin/audit?limit=&before=` | Журнал аудита (`orbit-admin`) |

Запросы, меняющие состояние, требуют заголовок `X-CSRF-Token` (из `/api/me`) и, если браузер передал `Origin`, совпадение с `ORBIT_PUBLIC_URL`. CORS не включается: SPA и API работают на одном origin.

## Безопасность

- Cookie сессии `HttpOnly`, `SameSite=Lax`, `Secure` на https; ID сессии хранится в БД только как SHA-256, содержимое — зашифровано и привязано к ID.
- Сессия пересоздаётся при каждом входе (защита от fixation); `return_to` принимает только относительные пути (нет open redirect).
- URL сервисов и иконок — только абсолютные `http(s)` без учётных данных (нет `javascript:`-ссылок); доступ к сервисам и избранному проверяется на сервере, недоступные сервисы для пользователя неотличимы от несуществующих.
- Rate limiting по IP: `/auth/*`, загрузка аватаров, все изменяющие запросы.
- Заголовки: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, HSTS на https.
- Административные токены Keycloak никогда не попадают в браузер.

Что остаётся на эксплуатацию: TLS на входе, секреты через secret manager, резервное копирование PostgreSQL и хранилища аватаров, метрики.

## Разработка

```bash
make test    # go test -race + vitest
make lint    # go vet + tsc
make build   # фронтенд и бинарник бэкенда
```

```
backend/
  cmd/orbit/            точка входа, wiring, graceful shutdown
  internal/api/         HTTP: маршруты, middleware (сессия, CSRF, rate limit), обработчики
  internal/auth/        OIDC-провайдер и серверные сессии
  internal/keycloak/    клиент Admin REST API
  internal/avatar/      проверка и перекодирование изображений, ФС/S3
  internal/catalog/     правила видимости и валидация сервисов
  internal/store/       PostgreSQL, миграции, in-memory реализация для тестов
  internal/seal/        AES-GCM и случайные токены
frontend/src/
  pages/                Главная, Сервисы, Профиль, Безопасность, Администрирование
  components/           Layout, Avatar, AvatarEditor (кадрирование), ServiceCard
deploy/keycloak/        realm для локальной разработки
```

## Дальше по плану

Регистрация по приглашениям и доменам (этап 5), пользовательские OAuth-интеграции (этап 4), метрики и мониторинг, статус доступности сервисов, уведомления о важных изменениях аккаунта.
