# vueltapp — Contexto para Claude Code

## El proyecto

**vueltapp** es una app de carpooling para la comunidad de parcelas de Puerto Varas (PBI = Parcelamiento). Los vecinos comparten viajes al pueblo y registran quién debe a quién. JT es el único operador.

Deploy en: `https://vueltapp.pages.dev` (Cloudflare Pages)
Repo local: `/Users/jtpetour/Desktop/vueltapp`

---

## Archivos

| Archivo | Descripción |
|---|---|
| `index.html` | SPA completa (CSS + HTML + JS inline) |
| `gas.js` | Backend legacy Google Apps Script (ya no se usa) |
| `schema.sql` | Schema de Supabase — correr en SQL Editor al configurar |

---

## URLs clave

- **App:** `https://vueltapp.pages.dev`
- **Supabase proyecto:** `https://sooomvkknvmkhraxrhmv.supabase.co`
- **Supabase anon key:** en `index.html` variable `SUPABASE_ANON_KEY`
- **Google Client ID:** `475898847047-f3qee1tpouf67t2rf7emo98ujgaqtj3c.apps.googleusercontent.com`

---

## Arquitectura Supabase

**Tablas:** `users`, `trips`, `requests`, `payments`

**Auth:** Supabase Auth (Google OAuth + Magic Link nativos)
- Google OAuth configurado en Authentication → Providers → Google
- Redirect URL autorizada en Google Cloud: `https://sooomvkknvmkhraxrhmv.supabase.co/auth/v1/callback`
- Site URL en Supabase: `https://mercadovecinos.github.io/vueltapp/`

**Emails:** DB triggers via `pg_net` → Resend API
- Configurar en `schema.sql`: reemplazar `!!RESEND_KEY!!`, `!!FROM_EMAIL!!`, `!!APP_URL!!`
- Requiere cuenta en resend.com + dominio verificado

**RPCs especiales:**
- `get_request_for_email(p_token)` — leer solicitud por token sin auth
- `respond_to_request_by_token(p_token, p_action, p_comment)` — aprobar/rechazar desde link de email

---

## Estado actual de la app

### Tabs
- **Viajes**: semana navegable (← →), tarjetas por día, muestra cupos, estado de solicitud propia
- **Publicar**: form nuevo viaje + banner para repetir viajes de semana anterior
- **Mis viajes**: mis viajes como conductor + mis solicitudes como pasajero
- **Balance**: quién me debe / a quién debo ($2.000 por viaje), botón pagar
- **Perfil**: nombre, parcela, logout

### Auth
- Google Sign-In (GSI)
- Magic link por email (passwordless)
- Primera vez: pide parcela (1–50) y nombre (si es magic link)

### Features implementadas
- Solicitar cupo con nota opcional para el conductor
- Aprobar/rechazar desde app o desde email (link directo)
- Email al pasajero con resultado
- Cancelar viaje (conductor) — notifica pasajeros
- Cancelar solicitud (pasajero) — notifica conductor si estaba aprobado
- Repetir viajes de semana anterior (selección individual)
- Historial hasta 4 semanas atrás
- Balance + registrar pagos (solo el acreedor puede marcar pagado)

---

## Estructuras de datos clave

```js
// Trip
{ id, driverId, driverName, driverParcela, date, time,
  direction: 'salida'|'regreso', puebloPoint, totalSeats, note, createdAt }

// Request
{ id, tripId, driverId, driverEmail, driverName,
  requesterId, requesterEmail, requesterName, requesterParcela,
  status: 'solicitado'|'aprobado'|'rechazado'|'cancelado',
  token, driverComment, note, createdAt, updatedAt }

// Payment
{ id, fromUserId, toUserId, amount, createdAt }

// AuthToken
{ id, email, expiresAt }  // tokens magic link, uso único, 15 min
```

---

## Patrones de código importantes

### api() — fetch con fallback JSONP para móvil
```js
function api(action, params) {
  // fetch normal, si no responde en 5s → JSONP fallback
  // timeout total JSONP: 10s
  // siempre resuelve (nunca rechaza) — error viene en res.error
}
```

### Cache (stale-while-revalidate)
```js
var CACHE_TTL = 3 * 60 * 1000; // 3 min
// cacheKey incluye userId + start + end
// getCached / setCache usan localStorage
```

### In-memory (prefetch al entrar)
```js
var myTripsData = null;  // mis viajes como conductor
var myReqsData = null;   // mis solicitudes como pasajero
var balanceData = null;  // balance calculado
var tripsCache = null;   // viajes de la semana visible
```

### prefetchAll() — al entrar a la app
Lanza 5 requests en paralelo: semana actual, próxima semana, myTrips, myRequests, balance.

---

## Brand / UI

- **Colores:** `--p:#2c5530` (verde), `--pl:#4a8c50`, `--pa:#e8855a` (naranja), `--bg:#f4f0eb`
- **Fuente:** system-ui (sin Google Fonts)
- **Mobile-first**, max-width 480px
- Sin dark mode (por ahora)
- Toast para feedback breve

---

## Notas de deploy

- **GAS:** siempre desplegar como "Nueva versión" + correr `autorizar()`
- **GitHub Pages:** `git push` desde CLI
- **Magic link URL** hardcodeada en gas.js: `https://mercadovecinos.github.io/vueltapp/?token=`

---

## Validación de sintaxis JS

```bash
python3 -c "
import re
with open('index.html') as f: content = f.read()
scripts = re.findall(r'<script[^>]*>(.*?)</script>', content, re.DOTALL)
with open('/tmp/check.js', 'w') as f: f.write('\n'.join(scripts))
"
node --check /tmp/check.js
```

Siempre correr esto después de editar index.html.
