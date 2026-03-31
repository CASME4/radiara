# RADIARA — Setup de Supabase

Guia paso a paso para configurar Supabase como backend de auth y creditos.

---

## 1. Crear proyecto en Supabase

1. Ir a https://supabase.com y crear cuenta (o iniciar sesion)
2. Click en **New Project**
3. Configurar:
   - **Name:** `radiara`
   - **Database Password:** elegir una password segura y guardarla
   - **Region:** el mas cercano (ej: `South America - Sao Paulo` si estas en LATAM)
4. Esperar ~2 minutos a que el proyecto se cree

---

## 2. Obtener las keys para .env

1. En el dashboard del proyecto, ir a **Settings > API** (menu lateral)
2. Copiar estos dos valores:
   - **Project URL** → es tu `SUPABASE_URL`
   - **anon public** (bajo Project API keys) → es tu `SUPABASE_ANON_KEY`
3. Pegarlos en el archivo `.env` del proyecto:

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxx
```

---

## 3. Crear las tablas

Ir a **SQL Editor** en el menu lateral de Supabase y ejecutar este SQL completo:

```sql
-- =============================================
-- RADIARA: Tablas para auth y creditos
-- =============================================

-- 1. PROFILES
-- Se crea automaticamente cuando un usuario se registra (via trigger)
-- Campos: role (user/admin), credits (creditos sueltos disponibles)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  role text not null default 'user' check (role in ('user', 'admin')),
  credits integer not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. SUBSCRIPTIONS
-- Suscripciones mensuales activas
create table public.subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  status text not null default 'active' check (status in ('active', 'cancelled', 'expired')),
  plan text not null default 'basic',
  monthly_limit integer not null default 50,
  period_start timestamptz not null default date_trunc('month', now()),
  period_end timestamptz not null default (date_trunc('month', now()) + interval '1 month'),
  created_at timestamptz not null default now()
);

-- 3. USAGE_LOG
-- Registro de cada uso de herramienta IA
create table public.usage_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  tool text not null,
  source text not null check (source in ('subscription', 'credits', 'admin')),
  created_at timestamptz not null default now()
);

-- Indices para queries frecuentes
create index idx_subscriptions_user_status on public.subscriptions(user_id, status);
create index idx_usage_log_user_date on public.usage_log(user_id, created_at);

-- =============================================
-- TRIGGER: crear perfil automaticamente al registrarse
-- =============================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role, credits)
  values (new.id, 'user', 3);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================
-- TRIGGER: actualizar updated_at en profiles
-- =============================================
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at();
```

---

## 4. Configurar Row Level Security (RLS)

Ejecutar en **SQL Editor**:

```sql
-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

-- PROFILES
alter table public.profiles enable row level security;

-- Cada usuario solo ve su propio perfil
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Solo el backend (service_role) puede actualizar creditos
-- Los usuarios no pueden modificar su propio role ni credits
create policy "Users can update own profile (non-sensitive)"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select role from public.profiles where id = auth.uid())
    and credits = (select credits from public.profiles where id = auth.uid())
  );

-- SUBSCRIPTIONS
alter table public.subscriptions enable row level security;

-- Cada usuario solo ve sus propias suscripciones
create policy "Users can read own subscriptions"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- Solo backend puede crear/modificar suscripciones
-- (no hay policy de insert/update para anon/authenticated)

-- USAGE_LOG
alter table public.usage_log enable row level security;

-- Cada usuario solo ve su propio historial
create policy "Users can read own usage"
  on public.usage_log for select
  using (auth.uid() = user_id);

-- El backend inserta via service_role, pero por si se usa anon key:
create policy "Users can insert own usage"
  on public.usage_log for insert
  with check (auth.uid() = user_id);
```

**Importante:** El middleware del server (`server/middleware/auth.js`) usa la `anon key` para las queries. Si necesitas que el backend pueda modificar credits y subscriptions sin restriccion, usa la **service_role key** en vez de la anon key en el `.env`. La service_role key bypasea RLS. La encontras en **Settings > API > service_role secret**.

Si preferis usar la service_role key en el backend (recomendado para produccion):

```
SUPABASE_ANON_KEY=eyJ...    (esta es para el frontend)
SUPABASE_SERVICE_KEY=eyJ...  (esta es para el backend - bypasea RLS)
```

---

## 5. Crear el usuario admin de Eddy

### Opcion A: Desde el dashboard

1. Ir a **Authentication > Users** en el dashboard
2. Click **Add user > Create new user**
3. Poner email y password
4. Una vez creado, copiar el **User UID** que aparece en la lista
5. Ir a **SQL Editor** y ejecutar:

```sql
-- Reemplazar 'PEGAR-UUID-AQUI' con el UUID real del usuario
update public.profiles
set role = 'admin', credits = 999999
where id = 'PEGAR-UUID-AQUI';
```

### Opcion B: Registrarse desde la app y luego promover

1. Abrir RADIARA en el navegador y registrarse normalmente
2. Confirmar el email (llega un link)
3. Ir a **Authentication > Users** en Supabase, copiar el UUID
4. Ejecutar el mismo SQL de arriba para setear role = admin

---

## 6. Verificar que todo funciona

1. Asegurate de que `.env` tiene las keys:
   ```
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_ANON_KEY=eyJ...
   ```

2. Arrancar el servidor:
   ```bash
   node server/index.js
   ```
   Deberia decir `RADIARA corriendo en http://localhost:3000` SIN el warning de "Supabase no configurado".

3. Probar auth:
   - Abrir http://localhost:3000
   - Registrarse con email/password
   - Intentar usar una herramienta de IA → deberia funcionar (3 creditos gratis de inicio)
   - Usar 3 veces → la cuarta deberia dar "Sin creditos"

4. Verificar en Supabase:
   - **Table Editor > profiles** → deberia aparecer el usuario con credits descontados
   - **Table Editor > usage_log** → deberia tener los registros de uso

---

## Esquema de creditos (resumen)

| Tipo de usuario | Comportamiento |
|---|---|
| **Admin** (role='admin') | Uso ilimitado, nunca se descuentan creditos |
| **Suscriptor activo** | Usa hasta `monthly_limit` por mes, luego cae a creditos sueltos |
| **Usuario gratis** | Empieza con 3 creditos. Cuando se terminan → 402 |
| **Herramientas del navegador** | Conversor y SVG no pasan por el middleware, siempre gratis |

---

## Tablas: referencia rapida

```
profiles
  id          uuid (PK, FK → auth.users)
  role        text ('user' | 'admin')
  credits     integer (default 3)
  created_at  timestamptz
  updated_at  timestamptz

subscriptions
  id              uuid (PK)
  user_id         uuid (FK → profiles)
  status          text ('active' | 'cancelled' | 'expired')
  plan            text (default 'basic')
  monthly_limit   integer (default 50)
  period_start    timestamptz
  period_end      timestamptz
  created_at      timestamptz

usage_log
  id          uuid (PK)
  user_id     uuid (FK → profiles)
  tool        text (ej: '/restore-face')
  source      text ('subscription' | 'credits' | 'admin')
  created_at  timestamptz
```
