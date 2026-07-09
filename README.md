# Azure DevOps Task Backend

Backend inicial para crear `Task` hijas masivamente en Azure DevOps.

## Alcance

- Crea work items de tipo `Task`.
- Vincula cada task al work item padre con `System.LinkTypes.Hierarchy-Reverse`.
- Recibe `taskType` por task.
- Recibe `activity` por task como campo opcional.
- Recibe `originalEstimate` u `originalEstimateHH`; si no viene, usa el mismo valor de `remainingWork`.
- Usa el PAT ingresado desde el login local y lo mantiene solo en sesion del backend.
- Soporta `dryRun: true` para validar el request sin llamar a Azure DevOps.
- Si una task falla, continúa con las siguientes y devuelve resultado por fila.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Edita `.env`:

```env
PORT=3000
HOST=127.0.0.1
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
AZURE_DEVOPS_ORG=achsdev
AZURE_DEVOPS_PROJECT=CRM
AZURE_DEVOPS_TASK_TYPE_FIELD=Custom.TasktypeDev
AZURE_DEVOPS_ACTIVITY_FIELD=Microsoft.VSTS.Common.Activity
```

El PAT no se configura en `.env`. Cada usuario debe ingresarlo desde la pantalla de login local.
El PAT debe tener permisos de Azure DevOps para `Work Items: Read & Write`.

Para modo local desde el frontend separado, el PAT se puede registrar temporalmente en memoria del backend:

```bash
curl -X POST http://localhost:3000/api/auth/pat \
  -H "Content-Type: application/json" \
  -d '{"pat":"tu-pat"}'
```

El backend devuelve una cookie `HttpOnly` y usa esa sesion en `/api/tasks/bulk`.
La sesion vive solo en memoria del proceso Node y se elimina al reiniciar el backend o al llamar `DELETE /api/auth/pat`.

Para produccion en Render usa variables equivalentes a:

```env
HOST=0.0.0.0
NODE_ENV=production
FRONTEND_URL=https://tu-front.netlify.app
AZURE_DEVOPS_ORG=achsdev
AZURE_DEVOPS_PROJECT=CRM
AZURE_DEVOPS_TASK_TYPE_FIELD=Custom.TasktypeDev
AZURE_DEVOPS_ACTIVITY_FIELD=Microsoft.VSTS.Common.Activity
```

Con `NODE_ENV=production`, la cookie PAT se emite con `Secure` y `SameSite=None` para permitir llamadas desde el frontend publicado.

`AZURE_DEVOPS_TASK_TYPE_FIELD` es el reference name del campo que Azure DevOps usa para "Task Type".
Si tu proceso usa otro campo custom, cambia ese valor en `.env`.
`AZURE_DEVOPS_ACTIVITY_FIELD` es el reference name del campo que Azure DevOps usa para "Activity".

Para buscar el reference name real desde Azure DevOps:

```bash
curl "http://localhost:3000/api/azure/fields?search=Task%20type"
```

Para activity:

```bash
curl "http://localhost:3000/api/azure/fields?search=Activity"
```

Usa el valor `referenceName` que devuelva Azure DevOps, no el nombre visible del formulario.

Para listar los proyectos disponibles con la sesion PAT local:

```bash
curl http://localhost:3000/api/azure/projects
```

La respuesta esta filtrada y solo devuelve metadata basica de proyectos.

## Health check

```bash
curl http://localhost:3000/health
```

## Frontend separado

Este proyecto es solo API y no sirve HTML, CSS ni JavaScript de frontend.
La interfaz esta en el proyecto separado `azure-devops-task-frontend`.

En desarrollo:

```text
Backend API: http://localhost:3000
Frontend: http://localhost:5173
```

La interfaz permite ingresar `parentId`, pegar tasks desde Excel o Google Sheets y ejecutar creacion real.
La interfaz tambien permite escoger o editar el proyecto destino. El navegador llama al backend local por `/api`; no llama Azure DevOps directamente y no guarda datos en storage.

Valores disponibles para `title`:

```text
[QA]Identificación CP
[QA]Desarrollo CP
[QA]SL -Iteración PO
[QA]Ejecución CP
```

Al seleccionar `[QA]SL -Iteración PO`, `remainingWork` y `originalEstimateHH` quedan en `0.5` por defecto si estaban vacios. Ambos campos siguen siendo editables.

Valores disponibles para `taskType`:

```text
QA
Desarrollo
Reuniones
Ceremonias Scrum
```

Valores disponibles para `activity` cuando se envia:

```text
TESTING
DEPLOYMENT
DESIGN
DEVELOPMENT
DOCUMENTATION
REQUERIMENTS
```

Orden de columnas al pegar:

```text
title    description    taskType    remainingWork    originalEstimateHH
```

`description` es requerido porque el proceso de Azure DevOps lo exige para `Task`.

## Dry run

Valida el payload y devuelve solo estados resumidos por fila.
El backend no devuelve el JSON Patch ni respuestas crudas de Azure DevOps al navegador.

```bash
curl -X POST http://localhost:3000/api/tasks/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "parentId": "410960",
    "project": "CRM",
    "dryRun": true,
    "taskTypeField": "Custom.TasktypeDev",
    "tasks": [
      {
        "title": "Crear validaciones",
        "description": "Validar formulario",
        "assignedTo": "usuario@empresa.com",
        "remainingWork": 4,
        "originalEstimate": 4,
        "taskType": "Development",
        "activity": "TESTING",
        "tags": ["CRM", "Automatizacion"]
      }
    ]
  }'
```

## Crear tasks reales

Primero registra el PAT desde la pantalla de login local o por `/api/auth/pat`. Luego cambia `dryRun` a `false`.

```bash
curl -X POST http://localhost:3000/api/tasks/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "parentId": "410960",
    "project": "CRM",
    "dryRun": false,
    "tasks": [
      {
        "title": "Crear validaciones",
        "description": "Validar formulario",
        "remainingWork": 4,
        "originalEstimateHH": 4,
        "taskType": "Development",
        "activity": "TESTING"
      }
    ]
  }'
```

## Respuesta esperada

Con `dryRun: false`, la API devuelve:

```json
{
  "ok": true,
  "dryRun": false,
  "project": "CRM",
  "parentId": "410960",
  "total": 1,
  "created": 1,
  "failed": 0,
  "results": [
    {
      "index": 0,
      "status": "created",
      "title": "Crear validaciones",
      "id": 415821,
      "url": "https://dev.azure.com/..."
    }
  ]
}
```

Si una task falla, se marca como `failed` y el proceso continúa con las demás.
La respuesta de `/api/tasks/bulk` esta filtrada para exponer solo `status`, `id`, `url` y errores resumidos.
