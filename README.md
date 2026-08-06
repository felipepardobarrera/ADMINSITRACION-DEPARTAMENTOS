# Administracion de Departamentos

Sistema personal para controlar propiedades, dividendos hipotecarios, ingresos por arriendo, gastos operacionales y alertas por vencimiento.

## Que incluye

- Panel mensual por propiedad.
- Registro de ingresos por arriendo.
- Registro de gastos: dividendos, contribuciones, gastos comunes, seguros, mantenciones y otros.
- Control de proximos vencimientos hipotecarios.
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

Para activar las alertas en GitLab:

1. Agrega `SMTP_PASS` en `Settings > CI/CD > Variables` como variable enmascarada.
2. Crea una programacion diaria en `Build > Pipeline schedules` para la rama principal.
3. Usa la zona horaria `America/Santiago` y un horario como `15 9 * * *`.

GitHub puede mantenerse como respaldo del mismo repositorio.

## Uso diario

Abre `index.html`, registra pagos de arriendo y gastos, y usa `Exportar respaldo` cuando quieras guardar una copia de tus cambios.
