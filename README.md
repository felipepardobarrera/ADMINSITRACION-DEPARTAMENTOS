# Administracion de Departamentos

Sistema personal para controlar propiedades, dividendos hipotecarios, ingresos por arriendo, gastos operacionales y alertas por vencimiento.

## Que incluye

- Panel mensual por propiedad.
- Registro de ingresos por arriendo.
- Registro de gastos: dividendos, contribuciones, gastos comunes, seguros, mantenciones y otros.
- Control de proximos vencimientos hipotecarios.
- Informacion sincronizada entre computadores mediante Supabase.
- Vista publica de solo lectura y acceso privado de administrador.
- Respaldos documentales privados en la nube.
- Importacion y exportacion de respaldo JSON.
- Exportacion CSV para revisar en Excel.
- Alerta automatica por correo 3 dias antes del vencimiento del dividendo mediante GitHub Actions.

## Datos iniciales cargados

- DEP-507: COLON 6435 DP 507, rol 2902-522, credito BCI operacion 0614733.
- DEP-509: MARIA 6470 509, rol 703-88, credito Itau operacion 02162445.

## Alertas por correo

El flujo `.github/workflows/alertas-hipotecarias.yml` revisa diariamente los dividendos que vencen en 3 dias y envia correo a `FPARDO1996@GMAIL.COM`.

Para activar el envio real, agrega este secreto en GitHub: `Settings > Secrets and variables > Actions > New repository secret`.

- `SMTP_PASS`: clave de aplicacion de Gmail para `FPARDO1996@GMAIL.COM`.

El servidor `smtp.gmail.com`, el puerto `465`, el usuario y el destinatario ya estan configurados. `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM` y `ALERT_TO` quedan disponibles solo como ajustes opcionales.

En Gmail debes crear una clave de aplicacion, no usar tu clave normal.

Para probarlo manualmente, entra en GitHub a `Actions > Alertas hipotecarias > Run workflow` y selecciona `enviar_prueba = true`. Si los secretos estan correctos, deberia llegar un correo de prueba aunque no exista un vencimiento exactamente a 3 dias.

## Publicacion en GitHub Pages

GitHub Pages publica automaticamente el sitio desde la rama `main`. No se necesita un segundo flujo de publicacion.

## Publicacion en GitLab Pages

El archivo `.gitlab-ci.yml` comprueba el sistema y publica el sitio automaticamente desde la rama principal.

Enlace publico: https://administracion-departamentos-publico-f73f00.gitlab.io/

Para activar las alertas en GitLab:

1. Agrega `SMTP_PASS` en `Settings > CI/CD > Variables` como variable enmascarada.
2. Crea una programacion diaria en `Build > Pipeline schedules` para la rama principal.
3. Usa la zona horaria `America/Santiago` y un horario como `15 9 * * *`.

GitHub puede mantenerse como respaldo del mismo repositorio.

## Acceso y sincronizacion

El sitio publicado muestra la informacion financiera en modo de solo lectura. Para modificarla, pulsa `Ingresar` e inicia sesion con `FPARDO1996@GMAIL.COM`.

La primera vez, pulsa `Crear acceso inicial`, elige una contrasena de al menos 8 caracteres y confirma el mensaje que llegara al correo. Despues podras usar esa misma cuenta en cualquier computador.

Los ingresos, gastos, propiedades y dividendos se guardan en Supabase. Los archivos adjuntos se almacenan en un espacio privado y solo el administrador puede abrirlos o descargarlos.

### Recuperar registros del computador anterior

Los datos que se ingresaron antes de activar la nube permanecen en el navegador de ese computador. Para trasladarlos:

1. Abre el sistema en el computador anterior.
2. Ingresa como administrador.
3. El sistema detectara los movimientos anteriores y los sincronizara automaticamente.
4. Pulsa `Exportar respaldo` para conservar ademas una copia independiente.

Si prefieres hacerlo manualmente, exporta el respaldo desde el computador anterior y usa `Importar respaldo` en el nuevo.

La importacion sincroniza los registros y los archivos adjuntos con la nube. Conviene conservar el archivo exportado como copia adicional.

## Uso diario

Abre el sitio publicado, inicia sesion cuando necesites editar y usa `Exportar respaldo` periodicamente para guardar una copia adicional de tus datos.
