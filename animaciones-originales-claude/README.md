# Escenas animadas para el checkout de Hesloy

Tres ilustraciones vectoriales originales, decorativas y en bucle, para las opciones de pago del checkout:

| Archivo | Escena | Bucle | Pose estática (movimiento reducido) |
|---|---|---|---|
| `contra-entrega.svg` | Dos manos entregan y reciben un billete verde con Q | 5,4 s | Contacto: el billete sujeto por las dos manos |
| `transferencia.svg` | Una moneda Q viaja en arco de un banco a otro | 5,6 s | Moneda en lo alto del recorrido, ruta iluminada hasta la mitad |
| `tarjeta-pos.svg` | Una tarjeta se acerca al POS, pausa de lectura y se retira | 5,6 s | Tarjeta junto al lector, ondas y puntos de lectura visibles |

Otros archivos:

- `animations.css`: tokens de color día/noche, keyframes, pausa y movimiento reducido.
- `animations.js`: carga los SVG, les da IDs únicos y los pausa fuera de pantalla o con la pestaña oculta.
- `preview.html`: vista previa local con comparación día/noche, tamaños de lectura y vista ampliada.

Ninguna escena contiene texto, botones (Pausar, Repetir, Regresar), créditos ni marcas de «aprobado». La transferencia y el POS no afirman que un pago se haya completado.

---

## Vista previa

- **Doble clic** en `preview.html` funciona (file://). En ese modo el script usa las copias de los SVG que hay dentro de `<template>` al final del archivo.
- **Servida por HTTP**, la vista previa lee directamente los `.svg` de la carpeta (siempre actualizados):

  ```sh
  cd animaciones-originales-claude
  python3 -m http.server 8774
  # abrir http://localhost:8774/preview.html
  ```

El selector «Día y noche / Día / Noche» solo controla la vista previa. Las escenas en sí no tienen controles.

Si editas un `.svg` y quieres que el doble clic también muestre el cambio, regenera las copias:

```sh
python3 - <<'PY'
import re, pathlib
p = pathlib.Path('preview.html'); html = p.read_text()
tpl = '\n'.join(f'<template data-hsa-template="{n}">{pathlib.Path(n + ".svg").read_text().strip()}</template>'
                for n in ['contra-entrega', 'transferencia', 'tarjeta-pos'])
html = re.sub(r'<!-- hsa-templates:start -->.*<!-- hsa-templates:end -->',
              lambda m: '<!-- hsa-templates:start -->\n' + tpl + '\n<!-- hsa-templates:end -->', html, flags=re.S)
p.write_text(html)
PY
```

---

## Integración en el checkout

Aún no se modificó el checkout. Pagos, cuotas, mapa y plugin de ubicación quedan intactos. Estos pasos solo añaden decoración.

### 1. Copiar la carpeta y enlazar CSS y JS

```html
<link rel="stylesheet" href="/ruta/animaciones-originales-claude/animations.css">
<script src="/ruta/animaciones-originales-claude/animations.js" defer></script>
```

Por defecto, `animations.js` busca los `.svg` en **su misma carpeta**. Para otra ruta: `HesloyScenes.setBasePath('/assets/escenas/')`, o `data-src` en cada contenedor.

### 2. Colocar la escena en cada opción de pago

Opción A, contenedor que carga el SVG (recomendada):

```html
<div class="hsa-slot" data-hsa-scene="contra-entrega"></div>
<div class="hsa-slot" data-hsa-scene="transferencia"></div>
<div class="hsa-slot" data-hsa-scene="tarjeta-pos"></div>
<!-- ruta explícita opcional: data-src="/assets/escenas/contra-entrega.svg" -->
```

`.hsa-slot` reserva el alto con `aspect-ratio: 320 / 180` antes de que llegue el SVG, así que no hay salto de layout.

Opción B, SVG en línea: pega el contenido del `.svg` directamente en el HTML. `animations.js` lo detecta por la clase `hsa-scene`. **Importante:** el SVG debe ir en línea (no como `<img>` ni como `background`), porque los colores de noche y la animación dependen del CSS de la página.

Si el checkout pinta las opciones de forma dinámica (tras una petición o un cambio de paso), llama de nuevo al script cuando el HTML ya exista:

```js
HesloyScenes.init(document.querySelector('#finalizar-compra'));
```

### 3. Tamaño

- Ancho fluido: el SVG ocupa el 100 % de su contenedor y mantiene la proporción 16:9 (`viewBox="0 0 320 180"`).
- Lectura recomendada: **260–300 px** de ancho. Se revisó entre 236 y 960 px (280 px en un teléfono de 320 px dentro de la vista previa). Por ejemplo: `.hsa-slot { max-width: 300px; margin-inline: auto; }`.
- No hace falta fijar un alto.

### 4. Tema día / noche

Los colores son variables CSS. El tema de día está activo por defecto. Para la noche:

```html
<html data-hsa-theme="noche">   <!-- o en cualquier ancestro, o en el propio <svg> -->
<html data-hsa-theme="auto">    <!-- sigue prefers-color-scheme -->
```

Si el checkout ya usa su propio selector (por ejemplo `[data-theme="dark"]`), basta con añadir ese selector a la regla de noche de `animations.css`:

```css
[data-hsa-theme="noche"] .hsa-scene,
.hsa-scene[data-hsa-theme="noche"],
[data-theme="dark"] .hsa-scene { /* …tokens de noche… */ }
```

Paleta base: día `#F4F1EA` / `#6B4E23`; noche `#0C0A09` / `#F2EDE2` / `#D9BC77`.

### 5. Clics, foco y lectores de pantalla

- Cada `<svg>` lleva `aria-hidden="true"`, `focusable="false"` y `pointer-events: none` (también en los hijos). Los clics atraviesan la escena y llegan a la opción de pago. Se comprobó haciendo clic sobre la ilustración: el radio de la opción se selecciona.
- No uses la escena como contenido informativo. El texto de la opción de pago debe seguir en HTML.
- Si se coloca dentro de un `<label>`, sigue funcionando como parte del área de clic del label.

### 6. API de `animations.js`

| Método | Uso |
|---|---|
| `HesloyScenes.init(root?)` | Monta todas las escenas dentro de `root` (por defecto, el documento). Se ejecuta solo al cargar. |
| `HesloyScenes.mount(el)` | Monta una escena (un contenedor `data-hsa-scene` o un `<svg class="hsa-scene">`). Devuelve una promesa. |
| `HesloyScenes.pause(el)` / `play(el)` | Pausa o reanuda una escena concreta, p. ej. si el panel se pliega. |
| `HesloyScenes.destroy(el)` | Deja de observarla (si se elimina del DOM). |
| `HesloyScenes.setBasePath(ruta)` | Carpeta donde están los `.svg`. |

---

## Grupos animables

Todo el movimiento usa **solo `transform`, `opacity` y `stroke-dashoffset`**: no se animan dimensiones ni nada que provoque layout. Las clases van prefijadas (`hsa-`, `ce-`, `tr-`, `pos-`) para no chocar con el CSS del checkout. La duración de cada bucle es una variable (`--hsa-ce-dur`, `--hsa-tr-dur`, `--hsa-pos-dur`).

### `contra-entrega.svg` — raíz `.hsa-scene.hsa-ce` (5,4 s)

Orden de capas: `ce-backdrop` → `ce-stage` { `ce-giver--back` → `ce-receiver--back` → `ce-bill` → `ce-bill-b` → `ce-giver--front` → `ce-receiver--front` }.

| Grupo | Qué contiene | Animación |
|---|---|---|
| `.ce-backdrop` | Halo (fuera del escenario; nunca cambia) | Estático |
| `.ce-giver--back` / `--front` | Mano que entrega (manga café con puño marfil). *back* = palma y dedos detrás del billete; *front* = pulgar, tenar y manga | Mismas pistas `translate` + `rotate` (pivote en la muñeca) en ambas capas: pieza rígida |
| `.ce-receiver--back` / `--front` | Mano que recibe (manga de punto) | Igual, con su propio pivote |
| `.ce-thumb` | Subgrupo del pulgar dentro de cada capa *front* | Giro rígido de 6–8° para abrir/cerrar la pinza (sin deformar) |
| `.ce-press` | Sombra de presión del pulgar sobre el papel | Opacidad |
| `.ce-bill` | Billete A | Copia exacta de la mano que lo sostiene (comprobado: desviación 0 u) |
| `.ce-bill-b` | Billete B (`<use>` del mismo dibujo) | Sigue siempre a la mano que entrega; sirve para el relevo del bucle |

Fases: reposo → alcance de quien entrega (curva de alcance preciso con un ligero arco) → quien recibe llega ~170 ms después → contacto quieto (~0,84 s) → pequeño tirón → quien recibe se lleva el billete y quien entrega suelta y se retira → reposo → relevo. En el relevo, el billete se desvanece en la mano que recibe y el billete B aparece en la de quien entrega; el cambio A↔B en el contacto es idéntico píxel a píxel. Las manos tienen el mismo estado al 0 % y al 100 %, sin fundido de escena ni fotograma vacío. Movimiento reducido: pose de contacto con el billete A sujeto.

Geometría de la mano: proporciones a partir de datos antropométricos (ANSUR II: palma ≈ 0,60 de la mano, dedo medio ≈ 0,66 de la palma) y de las articulaciones del modelo MoBL. Cascada de longitudes, dedos que se tocan en la PIP, pulgar con MCP a 0,57 de la palma, uña ≈ 7×5,6 u, tres pliegues palmares y luz única arriba a la izquierda.

### `transferencia.svg` — raíz `.hsa-scene.hsa-tr`

| Grupo | Qué contiene | Animación |
|---|---|---|
| `.tr-backdrop` | Halo, suelo, destellos | Estático |
| `.tr-bank--origen` / `.tr-bank--destino` | Banco con frontón / banco con cúpula | Estáticos |
| `.tr-glow--a` / `.tr-glow--b` | Luz cálida de ventanas y puerta | `tr-glow-origen` al salir, `tr-glow-destino` al llegar |
| `.tr-route` | Ruta punteada | Estática |
| `.tr-route-lit` / estela | Estela tipo cometa (varias capas con `pathLength`) | Avanza con la moneda (`stroke-dashoffset`) y desaparece al llegar; no es una barra de progreso |
| `.tr-pulse--origen` / `--destino` | Anillos suaves | `tr-pulse-*` (escala + opacidad, `transform-box: fill-box`) |
| `.tr-trail--1..3` | Estela de tres puntos | Misma animación que la moneda, con un retraso de 0,07 / 0,14 / 0,21 s |
| `.tr-coin` | Moneda Q con canto estriado | `tr-coin`: reposo → pequeña anticipación → arco con aceleración y frenado → leve asentamiento → se deposita en la cúpula → reaparece en el origen |

Las posiciones de `tr-coin` y `tr-lit` se calcularon sobre la **misma curva** (una Bézier cuadrática), muestreada por longitud de arco. Por eso la moneda y la línea iluminada avanzan siempre juntas. Si cambias la ruta, hay que recalcular ambos keyframes.

### `tarjeta-pos.svg` — raíz `.hsa-scene.hsa-pos`

| Grupo | Qué contiene | Animación |
|---|---|---|
| `.pos-backdrop` | Halo, suelo, destellos | Estático |
| `.pos-terminal` | POS: cuerpo con grosor, ranura de impresora, zona de lectura, pantalla, 12 teclas y 3 teclas de función | Estático (salvo los dos grupos siguientes) |
| `.pos-screen-glow` | Brillo cálido de la pantalla | `pos-glow` durante la lectura |
| `.pos-dot--1..3` | Puntos de lectura en pantalla | `pos-dot` en secuencia (sin estado final) |
| `.pos-card-x` › `.pos-card-y` | Tarjeta: chip con contactos, símbolo sin contacto, guilloché, puntos en relieve (sin número real), emblema abstracto, sombra | Dos ejes con curvas distintas (`pos-card-x`, `pos-card-y` + giro) para que la trayectoria sea un arco natural |
| `.pos-card-sheen` | Brillo recortado a la tarjeta | `pos-sheen` al acercarse |
| `.pos-wave--1..3` | Ondas de proximidad | `pos-wave`: dos pulsos discretos durante la pausa |

Fases (5,6 s): reposo → acercamiento en arco (~0,9 s, X e Y con curvas distintas) → toque → **lectura** con ondas que se encienden de dentro hacia fuera (solo opacidad) → pequeño despegue → retirada más ligera que la llegada → reposo. La tarjeta es champán, solo con chip y emblema; las teclas de función son tonales (sin semáforo) y la pantalla muestra Q sin estado final.

---

## Rendimiento y accesibilidad

- **Pausa fuera de pantalla:** `IntersectionObserver` (margen de 200 px) añade `hsa-paused` y `hsa-offscreen`. La escena se pausa y deja de pintarse (`visibility: hidden`) sin perder su espacio en el layout. Al imprimir vuelve a ser visible.
- **Pestaña oculta:** con `visibilitychange` se pausan todas.
- **Sin recálculo de layout por fotograma:** solo se animan `transform`, `opacity` y `stroke-dashoffset`. Las sombras se hacen con capas y degradados, sin filtros de desenfoque.
- **`prefers-reduced-motion: reduce`:** el CSS elimina todas las animaciones y queda la pose del marcado (ver la tabla del inicio). El efectivo muestra el billete sujeto por ambas manos.
- **IDs únicos:** todos los `id` internos (degradados, recortes, máscara) se renombran al montar cada instancia. Así varias copias, incluso en temas distintos, no se pisan entre sí.
- **CSP estricta:** cada color existe dos veces, como variable en `style` y como atributo de presentación de respaldo (`fill="#…"`). Si una política bloquea los `style` en línea, la escena se ve en colores de día y el movimiento sigue funcionando (se comprobó con `style-src 'self'`). Lo mismo sirve para abrir los `.svg` en un editor vectorial.
- **Peso:** `contra-entrega.svg` 86 KB (≈21 KB gzip), `transferencia.svg` 34 KB, `tarjeta-pos.svg` 26 KB.

### Medición de fluidez (medida, no estimada)

Medido con `requestAnimationFrame` durante 6–8 s en **Chromium 141 headless** (Playwright, sin GPU, en un contenedor Linux). La reducción de CPU se hizo con `Emulation.setCPUThrottlingRate` de DevTools. Son cifras de referencia de este entorno, no de un teléfono real.

| Condición | Escenas animándose | FPS medio |
|---|---|---|
| `preview.html` escritorio 1280×900, DPR 2 | 6 visibles (18 en el DOM) | 60 |
| `preview.html` móvil 390×844, DPR 3, CPU ×4 | 3 visibles (18 en el DOM) | 46,1 |

La versión actual tiene más capas que la anterior (manos rehechas, sombras de contacto). En móvil, con la CPU reducida ×4 y 18 instancias en la página, baja a unos 46 fps. En el checkout real habrá normalmente una escena visible por método de pago. Las cifras varían ±2 fps entre ejecuciones. El efectivo es la escena más costosa (máscara de bordes y muchas capas con degradado). En el checkout real normalmente se ve una escena por método de pago, lo que corresponde a las filas de 1–2 escenas. No se midió en Safari ni Firefox ni en dispositivos físicos.

---

## Originalidad y recursos

- Toda la geometría se construyó desde cero con coordenadas propias: manos (palma, dedos con articulaciones, pulgar en oposición con uña, lúnula y pliegues), mangas, billete, bancos, moneda, tarjeta y POS. No se usaron, trazaron ni adaptaron contornos de Storyset ni de ningún otro banco de recursos.
- La «Q» es una forma dibujada (no una fuente), así que no depende de tipografías del sistema.
- Sin imágenes PNG/WebP, fotos, emojis, imágenes incrustadas ni recursos externos. Nada exige crédito visible.
- El billete es inventado (rosetón, guilloché, pluma estilizada, hilo de seguridad, microtexto simulado) y no reproduce ningún billete real. La tarjeta no tiene número, nombre ni logotipo de ninguna red.

## Notas para quien integre

- No se tocaron el checkout, los pagos, las cuotas, el mapa ni el plugin de ubicación.
- La carpeta de referencia (`/Volumes/MAC/…/carrito-checkout-2026-10-06/`) y `localhost:8773` no estaban disponibles en el entorno donde se crearon estas escenas. El estilo se ajustó a lo descrito en el encargo (paleta, acabado, gesto aprobado): conviene compararlo con la escena actual al integrarlo.
- Verificado en Chromium: carga por `file://` y por HTTP, ausencia de IDs duplicados con 18 instancias, clic que atraviesa la escena, pausa con pestaña oculta y fuera de pantalla, movimiento reducido, CSP estricta, y sin scroll horizontal a 320, 390, 820 y 1440 px.

## Investigación aplicada

Para esta versión se revisaron skills públicas de GitHub y guías de Apple. Lo que se tomó:
- `rshankras/claude-code-apple-skills` (animation-patterns, game-feel), `raintree-technology/apple-hig-skills`, `ebuntario/apple-hig`, `axiaoge2/Apple-Hig-Designer` y `anthropics/skills` (frontend-design): luz única, sombras de contacto y ambiente, modo noche que eleva superficies, y movimiento con propósito con alternativa de movimiento reducido.
- `dylantarre/animation-principles`, `calesthio/openmontage` (svg-character-animation) y `affaan-m/everything-claude-code` (motion-patterns): curvas de alcance de mínimo tirón, arcos, solapamiento y tiempos asimétricos de llegada y salida.
- HIG de Apple (Motion, Dark Mode, Tap to Pay) y WWDC «Designing Fluid Interfaces» / «Animate with springs»: muelles críticamente amortiguados, quietud en lugar de lentitud, ondas tipo *variable color* y ningún estado de éxito.

Pendiente conocido: el relevo del billete dura unos 0,2 s y deja ver un instante los dedos a través del papel, y el empuje final de la tarjeta sobre el lector puede afinarse. Ambos están descritos en las notas de revisión y no impiden integrar.
