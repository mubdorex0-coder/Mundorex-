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
- Al iniciar el servidor sin cuenta creada, se genera un **código de instalación** de un solo uso (8 letras/números). Lo verás en la terminal, por ejemplo:
  `*** Código de instalación para crear la cuenta del dueño: ABCD2345 ***`
  y también queda guardado en el archivo **`setup-code.txt`** de la carpeta del proyecto (solo lo puede leer el dueño del servidor). El código **nunca** se muestra en la página web.
- Entra a **/admin**: aparece **"Crear cuenta de dueño"**. Escribe el código de instalación, tu usuario y una contraseña de al menos 8 caracteres (dos veces).
- Al crear la cuenta, el código se invalida y `setup-code.txt` se borra. No hay contraseña de fábrica y solo puede existir **una** cuenta.
- Si escribes mal el código, cuenta como intento fallido (5 fallos = 15 minutos de bloqueo). Así, aunque la página esté publicada, nadie puede adueñarse del panel sin ese código.
- En hostings donde no ves archivos (Render, Railway), mira el código en los **logs** del servicio, o define tú el código con la variable de entorno `SETUP_CODE` (por ejemplo `SETUP_CODE=MiCodigo2026 node server.js`); en ese caso no se crea `setup-code.txt`. Después de crear la cuenta puedes borrar esa variable.
- Si fallas 5 veces la contraseña, el ingreso se bloquea 15 minutos.
- La sesión dura 12 horas. Usa **"Cerrar sesión"** cuando termines.
- ¿Olvidaste la contraseña? Borra el archivo `auth.json` del servidor y reinicia el servidor: se genera un código de instalación nuevo y puedes crear la cuenta otra vez (tu contenido no se pierde).

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
- `setup-code.txt`: código de instalación temporal; existe solo hasta que creas la cuenta.

Haz copias de seguridad de `content.json`, `auth.json` y `uploads/` de vez en cuando.
