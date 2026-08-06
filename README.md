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

Para activar el envio real, agrega estos secretos en GitHub: `Settings > Secrets and variables > Actions > New repository secret`.

- `SMTP_HOST`: servidor SMTP. Para Gmail: `smtp.gmail.com`.
- `SMTP_PORT`: para Gmail usa `465`.
- `SMTP_USER`: correo que enviara la alerta.
- `SMTP_PASS`: clave de aplicacion del correo emisor.
- `ALERT_TO`: correo receptor. Si no se define, usa el correo configurado en `data/properties.json`.

En Gmail debes crear una clave de aplicacion, no usar tu clave normal.

Para probarlo manualmente, entra en GitHub a `Actions > Alertas hipotecarias > Run workflow` y selecciona `enviar_prueba = true`. Si los secretos estan correctos, deberia llegar un correo de prueba aunque no exista un vencimiento exactamente a 3 dias.

## Publicacion en GitHub Pages

El flujo `.github/workflows/pages.yml` publica el sistema como sitio estatico cuando hay cambios en la rama `main`.

## Uso diario

Abre `index.html`, registra pagos de arriendo y gastos, y usa `Exportar respaldo` cuando quieras guardar una copia de tus cambios.
