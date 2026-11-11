# Página de Baños Turismo + panel de administración

Página web para tu negocio de turismo en Baños de Agua Santa: Chivas en Baños, Hospedajes (con tipos de habitación), Departamentos cómodos, catálogo de productos, métodos de pago con bancos, testimonios y redes sociales. Todo se edita desde un panel protegido con usuario y contraseña, sin tocar código.

## 1. Qué necesitas
- **Node.js 18 o más nuevo** (descárgalo en https://nodejs.org). No hace falta instalar nada más: no usa `npm install`.

## 2. Cómo abrirla en tu computadora
1. Descomprime `pagina-banos.zip`.
2. Abre una terminal dentro de la carpeta y escribe:
   ```
   node server.js
   ```
3. Abre en tu navegador:
   - Página pública: http://localhost:3000
   - Panel del dueño: http://localhost:3000/admin

Para usar otro puerto: `PORT=8080 node server.js`.

## 3. Primer ingreso (crear tu cuenta)
- Entra a **/admin**. Si todavía no hay cuenta, verás **"Crear cuenta de dueño"**.
- Escribe un usuario (mínimo 3 caracteres) y una contraseña de al menos 8 caracteres, y confírmala. No hace falta ningún código de instalación.
- Solo puede existir **una** cuenta. Cuando ya existe, la página pasa a ser **"Iniciar sesión"** y no se puede crear otra.
- Si fallas 5 veces la contraseña, el ingreso se bloquea 15 minutos.
- La sesión dura 12 horas. Usa **"Cerrar sesión"** cuando termines.
- ¿Olvidaste la contraseña? Borra el archivo `auth.json` del servidor y reinicia: podrás crear la cuenta otra vez (tu contenido no se pierde).

## 4. Cómo editar cada sección
Entra a /admin, elige la sección en el menú de la izquierda, haz tus cambios y pulsa **"Guardar cambios"** (abajo a la derecha). Los cambios se ven al instante en la página.

- **General y encabezado:** nombre del negocio, título y subtítulo principal, foto de fondo, número de WhatsApp (con código de país, por ejemplo `593991234567`), mensaje de WhatsApp, correo, dirección, texto final y colores de la marca.
- **Servicios:** para Chivas en Baños, Hospedajes y Departamentos puedes cambiar título, descripción, foto, características (etiquetas: escribe y pulsa "+ Agregar"; la × las quita), texto del botón y el mensaje de WhatsApp de ese botón. El interruptor "Mostrar en la página" lo oculta o muestra. En **Hospedajes** está **"Tipos de habitación"** para agregar, editar o quitar habitaciones.
- **Productos:** "+ Agregar producto", con foto, nombre, descripción, precio (ejemplo `25.00`), moneda y texto del botón. Si pones un **enlace de compra** (Shopify, PayPal, etc.) el botón lleva ahí; si no, abre WhatsApp con el nombre y precio. "Agotado" desactiva el botón. "Eliminar" pide confirmación.
- **Beneficios** y **Testimonios:** agrega, edita, ordena (↑ ↓) o elimina. Los testimonios vienen como *ejemplo*: cámbialos por opiniones reales y quita la marca "Ejemplo" y la nota.
- **Métodos de pago:** agrega o quita formas de pago, con nombre, nota e ícono. En **Bancos aceptados**, el interruptor de cada banco lo muestra u oculta en la página; también puedes agregar, renombrar o quitar bancos. Esta sección solo informa: no cobra ni guarda datos de tarjetas. No publiques números de cuenta aquí; envíalos por WhatsApp.
- **Redes sociales:** pega el enlace de cada perfil (debe empezar con `https://`). En WhatsApp puedes poner solo el número. Si dejas un campo vacío, ese ícono no aparece.

**Fotos:** JPG, PNG, WEBP o GIF de hasta 5 MB. Después de subir una foto, recuerda pulsar "Guardar cambios". Las fotos que reemplazas o borras se eliminan del servidor.

## 5. Cambiar la contraseña
Panel → **"Cambiar contraseña"** → escribe tu contraseña actual, la nueva (mínimo 8 caracteres) y confírmala. Si la actual es incorrecta no se cambia (y cuenta como intento fallido). Al cambiarla se cierran las sesiones abiertas en otros dispositivos.

## 6. Publicar en internet
La página necesita un servidor con **Node.js**, porque el panel /admin guarda los cambios. **No sirve en hosting estático** (GitHub Pages, Netlify estático, etc.): ahí /admin no funciona.

Opciones:
- **Render** (render.com): crea un "Web Service", sube esta carpeta (por ejemplo a un repositorio de GitHub), comando de inicio `node server.js`. Agrega un **disco persistente** montado en la carpeta del proyecto (o al menos para `content.json`, `auth.json` y `uploads/`); sin disco, los cambios y fotos se borran en cada reinicio.
- **Railway** (railway.app): nuevo proyecto desde la carpeta o GitHub, comando `node server.js`, y agrega un **Volume** para guardar los datos.
- **VPS** (DigitalOcean, Contabo, etc.): copia la carpeta, instala Node y ejecútalo con `pm2 start server.js` o un servicio systemd. Ponlo detrás de Nginx o Caddy con **HTTPS**.

**HTTPS y proxy:** si tu proxy (Render, Railway, Nginx con `proxy_set_header X-Forwarded-Proto $scheme;`) envía `X-Forwarded-Proto: https`, la cookie de sesión se marca como `Secure` automáticamente. También puedes forzarlo con `COOKIE_SECURE=1`. Si el servidor está detrás de un proxy, agrega `TRUST_PROXY=1` para que el bloqueo por intentos fallidos use la IP real del visitante (encabezado `X-Forwarded-For`). **No** actives `TRUST_PROXY` si la app recibe visitas directas sin proxy, porque cualquiera podría falsificar ese encabezado.

## 7. Archivos
- `server.js`: el servidor (página + panel).
- `content.json`: todos los textos y datos de la página.
- `public/`: estilos y el código del panel.
- `uploads/`: fotos que subes desde el panel.
- `auth.json`: se crea solo cuando haces tu cuenta (guarda la contraseña cifrada). **No lo compartas.**
- `visits.json`: contador de visitas de la página pública. Se crea solo; no hace falta editarlo.
- `public/img/`: fotos de fondo de la página.

Haz copias de seguridad de `content.json`, `auth.json` y `uploads/` de vez en cuando.

## 8. Iniciar sesión con Google, Facebook o X
En la pantalla **Iniciar sesión** (cuando la cuenta de dueño ya existe) pueden aparecer botones de Google, Facebook y X. Solo se muestra el botón de una red si sus variables están definidas en el servidor. Instagram no está: ya no ofrece este tipo de acceso.

La red solo entra si es la cuenta del dueño. Si no, la página dice **«Esta cuenta no está autorizada»** y no abre el panel. Google y Facebook comparan el correo verificado de esa cuenta con `OWNER_EMAIL` (si no la defines, vale `mariobropvp0@gmail.com`). X no entrega el correo: compara el usuario de X con `OWNER_X_USERNAME` (sin @).

Las direcciones de retorno se arman con `PUBLIC_URL` (sin barra al final). Si no la defines, se usa `https://mundorex.onrender.com`. En Render pon estas variables en **Environment** del servicio y reinicia.

**Google**
1. Entra a [Google Cloud Console](https://console.cloud.google.com/) → APIs y servicios → Pantalla de consentimiento de OAuth (tipo externo) y crea las credenciales.
2. Credenciales → Crear ID de cliente de OAuth → Aplicación web.
3. En **URI de redirección autorizados** agrega: `https://mundorex.onrender.com/auth/google/callback` (o `PUBLIC_URL` + `/auth/google/callback`).
4. En Render: `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.

**Facebook**
1. Entra a [Meta for Developers](https://developers.facebook.com/) → Crear app → agrega el producto **Facebook Login**.
2. Facebook Login → Configuración → **URI de redirección de OAuth válidos**: `https://mundorex.onrender.com/auth/facebook/callback`.
3. Pide el permiso `email`. Cuando quieras usarlo fuera de las cuentas de prueba, pasa la app a modo activo.
4. En Render: `FACEBOOK_APP_ID` (el identificador de la app) y `FACEBOOK_APP_SECRET`.

**X (Twitter)**
1. Entra a [developer.x.com](https://developer.x.com/) → tu proyecto → la app → **User authentication settings**.
2. Activa **OAuth 2.0**, tipo de app web y cliente confidencial. El servidor usa el flujo con PKCE.
3. Callback / Redirect URI: `https://mundorex.onrender.com/auth/x/callback`.
4. Permisos: `users.read` y `tweet.read`.
5. En Render: `X_CLIENT_ID`, `X_CLIENT_SECRET` y `OWNER_X_USERNAME` (tu usuario de X, sin @).
