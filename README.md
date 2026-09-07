# XML Comparator

Comparador visual de XML para GitHub Pages. Todo el análisis de los archivos seleccionados se realiza en el navegador; la aplicación no tiene backend ni endpoints de subida.

## Funciones

- Carga dinámica de XML A y XML B.
- Detección de subárboles agregados y eliminados.
- Cambios en atributos y texto.
- Detección heurística de reordenamientos.
- Señales de posibles cambios lógicos.
- Filtros por tipo, severidad, lógica y búsqueda.
- Vista de contexto tipo editor/VS Code con líneas coloreadas.
- Comparación manual X ↔ Y entre cualquier nodo del archivo A y cualquier nodo del archivo B.
- Tema oscuro y claro.
- Procesamiento local en el navegador.

## Seguridad y confidencialidad

La edición web usa una Content Security Policy con `connect-src 'none'`, por lo que el código de la página no puede realizar solicitudes `fetch`, XHR, WebSocket ni conexiones equivalentes. Los XML se leen mediante la File API del navegador y no se guardan en el repositorio.

Aun así, antes de usar información confidencial en producción, valida la política de tu organización y revisa la pestaña **Network** de las herramientas de desarrollo del navegador.

El parser rechaza XML que contienen `DOCTYPE` o `ENTITY`.

## Publicar con GitHub Pages

1. Crea un repositorio en GitHub, por ejemplo `xml-comparator`.
2. Copia todo el contenido de esta carpeta al repositorio.
3. En PowerShell, desde esta carpeta:

```powershell
git init
git add .
git commit -m "Initial XML Comparator web"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/xml-comparator.git
git push -u origin main
```

4. En GitHub abre **Settings → Pages**.
5. En **Build and deployment → Source**, selecciona **GitHub Actions**.
6. Abre la pestaña **Actions** y espera a que `Deploy XML Comparator` finalice correctamente.
7. GitHub mostrará la URL publicada, normalmente:

```text
https://TU-USUARIO.github.io/xml-comparator/
```

No necesitas comprar un dominio.

## Actualizaciones

Cada `git push` a `main` ejecuta automáticamente `.github/workflows/deploy.yml` y publica el contenido de `site/`.

## Desarrollo local

Por tratarse de módulos JavaScript, conviene abrirlo mediante un servidor estático local en lugar de hacer doble clic en `index.html`.

Con Python:

```powershell
cd site
python -m http.server 8080
```

Después abre:

```text
http://localhost:8080/
```

## Estructura

```text
.
├── .github/
│   └── workflows/
│       └── deploy.yml
├── site/
│   ├── assets/
│   │   └── xml-comparator-logo.svg
│   ├── css/
│   │   └── styles.css
│   ├── js/
│   │   ├── app.js
│   │   └── engine.js
│   ├── .nojekyll
│   └── index.html
├── .gitignore
└── README.md
```
