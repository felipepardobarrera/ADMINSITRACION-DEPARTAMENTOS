# Administración de Departamentos

Panel web para administrar propiedades, arriendos, gastos, dividendos hipotecarios y sus documentos de respaldo. Funciona en computador y teléfono, sincroniza los datos mediante Supabase y conserva una copia local cuando la nube no está disponible.

## Uso rápido

1. Abre el sitio publicado.
2. Elige el mes en la parte superior.
3. Revisa el panel, los resultados por departamento y los próximos vencimientos.
4. Pulsa **Ingresar** para agregar o editar información.
5. Antes de terminar, entra en **Respaldos** y descarga una copia JSON periódicamente.

La barra superior indica si los datos están al día en la nube o si se está mostrando una copia local.

## Funciones principales

- Resumen mensual y flujo de caja acumulado.
- Resultado individual por propiedad.
- Registro editable de ingresos y gastos.
- Archivos privados de respaldo de hasta 20 MB por movimiento.
- Próximos vencimientos hipotecarios y exportación de calendario.
- Informes CSV compatibles con Excel.
- Alertas diarias por correo tres días antes de un vencimiento.
- Vista pública de consulta y sesión privada de administrador.

## Respaldos y restauración

El botón **Respaldos** está disponible al iniciar sesión como administrador.

- **Descargar respaldo JSON** crea una copia completa de los registros y adjuntos disponibles. El archivo es legible y editable; se deben conservar los nombres de campos y listas.
- **Importar y reemplazar** valida la versión, estructura, fechas, montos, propiedades y tamaños antes de cambiar información. La aplicación muestra un resumen y pide confirmación.
- **Puntos automáticos** conservan las últimas ocho versiones en el navegador antes de agregar, editar, eliminar, importar o restaurar. Si la sincronización falla, el cambio se revierte.
- Los CSV neutralizan fórmulas peligrosas antes de abrirse en una hoja de cálculo.

Los puntos automáticos pertenecen solamente al navegador actual. El JSON descargado es la copia portátil que debe guardarse en otro lugar seguro.

## Configuración de Supabase

La aplicación usa el proyecto indicado en `app.js`. La clave incluida es una clave publicable para navegador; nunca se debe agregar una clave secreta o `service_role` al repositorio.

1. Abre el editor SQL del proyecto Supabase.
2. Ejecuta [supabase-schema.sql](supabase-schema.sql).
3. Crea en Authentication el usuario administrador `fpardo1996@gmail.com`.
4. Confirma que la URL publicada esté permitida en **Authentication > URL Configuration**.

El SQL es idempotente: puede volver a ejecutarse sin duplicar políticas. Activa RLS, crea la fila `main`, configura el bucket privado `documentos` y concede solo los permisos necesarios.

> Privacidad: la configuración actual permite lectura pública de los datos financieros del panel, sin acceso público a los adjuntos. Para un panel totalmente privado, elimina `anon` del permiso y de la política de lectura señalados en `supabase-schema.sql`, y adapta la pantalla pública.

## Alertas por correo

El flujo [.github/workflows/alertas-hipotecarias.yml](.github/workflows/alertas-hipotecarias.yml) se ejecuta diariamente. Primero consulta el estado actual de Supabase; si el servicio no responde, usa `data/properties.json` como copia de contingencia.

Configura en **Settings > Secrets and variables > Actions**:

- `SMTP_PASS` (obligatorio): clave de aplicación de Gmail, no la contraseña normal.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM` y `ALERT_TO` (opcionales).
- `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` (opcionales mientras coincidan con los valores públicos del proyecto).

Para probar el correo: **Actions > Alertas hipotecarias > Run workflow > enviar_prueba = true**.

## Desarrollo local

Requiere Node.js 20 o superior.

```bash
npm ci
npm test
npm start
```

`npm test` ejecuta pruebas de validación de respaldos, seguridad CSV/HTML, cálculo de fechas y sintaxis. Las dependencias están fijadas en `package-lock.json` y `npm audit` debe terminar sin vulnerabilidades.

## Publicación

- GitHub Pages puede publicar la rama `main` directamente.
- `.gitlab-ci.yml` mantiene compatibilidad con GitLab Pages.
- El enlace de recuperación de contraseña se calcula desde el dominio abierto, por lo que funciona en ambos despliegues si la URL está autorizada en Supabase.
