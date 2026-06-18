import express from "express";
import crypto from "node:crypto";
import {
  createChildTask,
  getWorkItemClassification,
  listClassificationNodes,
  listFields,
  listProjects,
  searchWorkItemsByIdPrefix
} from "./azureDevOpsClient.js";
import { normalizeTask, validateBulkRequest } from "./validation.js";

const patSessions = new Map();
const patCookieName = "azdo_pat_session";
const patSessionMaxAgeMs = 8 * 60 * 60 * 1000;
const isProduction = process.env.NODE_ENV === "production";

export function createApp({
  org = process.env.AZURE_DEVOPS_ORG || "achsdev",
  project = process.env.AZURE_DEVOPS_PROJECT || "CRM",
  taskTypeField = process.env.AZURE_DEVOPS_TASK_TYPE_FIELD || "Microsoft.VSTS.CMMI.TaskType",
  frontendUrl = process.env.FRONTEND_URL,
  fetchImpl
} = {}) {
  const app = express();

  app.use(buildCorsMiddleware(frontendUrl));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/auth/pat/status", (req, res) => {
    res.json({
      ok: true,
      configured: Boolean(getSessionPat(req))
    });
  });

  app.post("/api/auth/pat", (req, res) => {
    const requestPat = typeof req.body?.pat === "string" ? req.body.pat.trim() : "";

    if (!requestPat) {
      return res.status(400).json({
        ok: false,
        error: "PAT is required"
      });
    }

    const sessionId = crypto.randomUUID();

    patSessions.set(sessionId, {
      pat: requestPat,
      expiresAt: Date.now() + patSessionMaxAgeMs
    });

    res.setHeader("Set-Cookie", buildPatCookie(sessionId, Math.floor(patSessionMaxAgeMs / 1000)));
    res.status(204).end();
  });

  app.delete("/api/auth/pat", (req, res) => {
    const sessionId = getCookie(req, patCookieName);

    if (sessionId) {
      patSessions.delete(sessionId);
    }

    res.setHeader("Set-Cookie", buildPatCookie("", 0));
    res.status(204).end();
  });

  app.get("/api/azure/fields", async (req, res) => {
    const activePat = getSessionPat(req);
    const activeProject = req.query.project ? String(req.query.project).trim() : project;

    try {
      const fields = await listFields({
        org,
        project: activeProject,
        pat: activePat,
        search: req.query.search,
        fetchImpl
      });

      res.json({
        ok: true,
        count: fields.length,
        fields
      });
    } catch (error) {
      res.status(error.status || 500).json({
        ok: false,
        error: summarizeAzureReadError(error)
      });
    }
  });

  app.get("/api/azure/projects", async (req, res) => {
    const activePat = getSessionPat(req);

    try {
      const projects = await listProjects({
        org,
        pat: activePat,
        fetchImpl
      });

      res.json({
        ok: true,
        count: projects.length,
        projects
      });
    } catch (error) {
      res.status(error.status || 500).json({
        ok: false,
        error: summarizeAzureReadError(error)
      });
    }
  });

  app.get("/api/classification-nodes", async (req, res) => {
    const activePat = getSessionPat(req);
    const activeProject = req.query.project ? String(req.query.project).trim() : project;
    const type = req.query.type ? String(req.query.type).toLowerCase().trim() : "";
    const structureGroup = type === "areas" ? "Areas" : type === "iterations" ? "Iterations" : "";

    if (!structureGroup) {
      return res.status(400).json({
        ok: false,
        error: "Tipo de clasificacion invalido."
      });
    }

    try {
      const nodes = await listClassificationNodes({
        org,
        project: activeProject,
        pat: activePat,
        structureGroup,
        search: req.query.q,
        limit: 50,
        fetchImpl
      });

      res.json({
        ok: true,
        count: nodes.length,
        nodes
      });
    } catch (error) {
      res.status(error.status || 500).json({
        ok: false,
        error: summarizeAzureReadError(error)
      });
    }
  });

  app.get("/api/work-items/search", async (req, res) => {
    const activePat = getSessionPat(req);
    const activeProject = req.query.project ? String(req.query.project).trim() : project;
    const idPrefix = req.query.q ? String(req.query.q).trim() : "";

    try {
      const workItems = await searchWorkItemsByIdPrefix({
        org,
        project: activeProject,
        pat: activePat,
        idPrefix,
        top: 10,
        fetchImpl
      });

      res.json({
        ok: true,
        count: workItems.length,
        workItems
      });
    } catch (error) {
      res.status(error.status || 500).json({
        ok: false,
        error: summarizeAzureReadError(error)
      });
    }
  });

  app.post("/api/tasks/bulk", async (req, res) => {
    const validationErrors = validateBulkRequest(req.body);

    if (validationErrors.length > 0) {
      return res.status(400).json({
        ok: false,
        errors: validationErrors
      });
    }

    const parentId = String(req.body.parentId).trim();
    const activeProject = req.body.project ? String(req.body.project).trim() : project;
    const dryRun = req.body.dryRun !== false;
    const activePat = getSessionPat(req);
    const activeAreaPath = req.body.areaPath ? String(req.body.areaPath).trim() : undefined;
    const activeIterationPath = req.body.iterationPath
      ? String(req.body.iterationPath).trim()
      : undefined;
    const activeAssignedTo = req.body.assignedTo ? String(req.body.assignedTo).trim() : undefined;
    const inheritParentClassification = req.body.inheritParentClassification === true;
    let resolvedAreaPath = activeAreaPath;
    let resolvedIterationPath = activeIterationPath;
    const activeTaskTypeField = req.body.taskTypeField
      ? String(req.body.taskTypeField).trim()
      : taskTypeField;

    if (inheritParentClassification) {
      try {
        const parentClassification = await getWorkItemClassification({
          org,
          project: activeProject,
          pat: activePat,
          workItemId: parentId,
          fetchImpl
        });

        resolvedAreaPath = chooseInheritedClassificationPath(
          parentClassification.areaPath,
          activeAreaPath,
          activeProject
        );
        resolvedIterationPath = chooseInheritedClassificationPath(
          parentClassification.iterationPath,
          activeIterationPath,
          activeProject
        );
      } catch (error) {
        return res.status(error.status || 500).json({
          ok: false,
          error: summarizeAzureReadError(error)
        });
      }
    }

    const tasks = req.body.tasks.map((task) => {
      const normalizedTask = normalizeTask(task);

      return {
        ...normalizedTask,
        assignedTo: normalizedTask.assignedTo || activeAssignedTo,
        areaPath: inheritParentClassification ? resolvedAreaPath : normalizedTask.areaPath || resolvedAreaPath,
        iterationPath: inheritParentClassification
          ? resolvedIterationPath
          : normalizedTask.iterationPath || resolvedIterationPath
      };
    });

    if (dryRun) {
      return res.json({
        ok: true,
        dryRun: true,
        project: activeProject,
        areaPath: resolvedAreaPath,
        iterationPath: resolvedIterationPath,
        inheritParentClassification,
        assignedTo: activeAssignedTo,
        parentId,
        total: tasks.length,
        tasks: buildDryRunTaskResults(tasks)
      });
    }

    const results = [];

    for (const [index, task] of tasks.entries()) {
      try {
        const createdTask = await createChildTask({
          org,
          project: activeProject,
          pat: activePat,
          parentId,
          task,
          taskTypeField: activeTaskTypeField,
          fetchImpl
        });

        results.push({
          index,
          status: "created",
          title: task.title,
          id: createdTask.id,
          url: createdTask.url
        });
      } catch (error) {
        results.push({
          index,
          status: "failed",
          title: task.title,
          error: summarizeCreateError(error)
        });
      }
    }

    const created = results.filter((result) => result.status === "created").length;
    const failed = results.length - created;

    res.status(failed > 0 ? 207 : 201).json({
      ok: failed === 0,
      dryRun: false,
      project: activeProject,
      areaPath: resolvedAreaPath,
      iterationPath: resolvedIterationPath,
      inheritParentClassification,
      assignedTo: activeAssignedTo,
      parentId,
      total: results.length,
      created,
      failed,
      results
    });
  });

  app.use((err, _req, res, _next) => {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  });

  return app;
}

function buildCorsMiddleware(frontendUrl) {
  const allowedOrigins = new Set(
    [
      ...(frontendUrl || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
      ...(isProduction ? [] : ["http://localhost:5173", "http://127.0.0.1:5173"])
    ]
  );

  return (req, res, next) => {
    const origin = req.get("origin");

    if (origin && allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
      res.setHeader("Vary", "Origin");
    }

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    next();
  };
}

function buildPatCookie(value, maxAgeSeconds) {
  const sameSite = isProduction ? "None" : "Lax";
  const secure = isProduction ? "; Secure" : "";

  return `${patCookieName}=${encodeURIComponent(
    value
  )}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

export function buildDryRunTaskResults(tasks) {
  return tasks.map((task, index) => ({
    index,
    status: "validated",
    title: task.title
  }));
}

export function summarizeCreateError(error) {
  if (error?.status === 401 || error?.status === 403) {
    return "No autorizado para crear tasks en Azure DevOps.";
  }

  if (error?.status === 404) {
    return "No se encontro el proyecto, work item padre o endpoint configurado.";
  }

  if (error?.status === 400 && /required|invalidempty|tf401320/i.test(error.message)) {
    return "Azure DevOps rechazo la task por campos requeridos o vacios.";
  }

  if (error?.status) {
    return `Azure DevOps rechazo la task. Codigo ${error.status}.`;
  }

  return "No se pudo crear la task.";
}

export function summarizeAzureReadError(error) {
  if (error?.status === 401 || error?.status === 403) {
    return "No autorizado para consultar Azure DevOps.";
  }

  if (error?.status === 404) {
    return "No se encontro el recurso solicitado en Azure DevOps.";
  }

  if (/PAT/i.test(error?.message || "")) {
    return "PAT requerido para consultar Azure DevOps.";
  }

  if (error?.status) {
    return `Azure DevOps rechazo la consulta. Codigo ${error.status}.`;
  }

  return "No se pudo consultar Azure DevOps.";
}

export function chooseInheritedClassificationPath(fetchedPath, fallbackPath, project) {
  const normalizedFetchedPath = fetchedPath ? String(fetchedPath).trim() : "";
  const normalizedFallbackPath = fallbackPath ? String(fallbackPath).trim() : "";
  const normalizedProject = project ? String(project).trim() : "";

  if (!normalizedFetchedPath) {
    return normalizedFallbackPath || undefined;
  }

  if (
    normalizedFallbackPath &&
    normalizedProject &&
    normalizedFetchedPath.toLowerCase() === normalizedProject.toLowerCase() &&
    normalizedFallbackPath.toLowerCase() !== normalizedProject.toLowerCase()
  ) {
    return normalizedFallbackPath;
  }

  return normalizedFetchedPath;
}

function getSessionPat(req) {
  const sessionId = getCookie(req, patCookieName);

  if (!sessionId) {
    return undefined;
  }

  const session = patSessions.get(sessionId);

  if (!session) {
    return undefined;
  }

  if (session.expiresAt <= Date.now()) {
    patSessions.delete(sessionId);
    return undefined;
  }

  return session.pat;
}

function getCookie(req, name) {
  const cookieHeader = req.get("cookie");

  if (!cookieHeader) {
    return undefined;
  }

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const matchingCookie = cookies.find((cookie) => cookie.startsWith(`${name}=`));

  if (!matchingCookie) {
    return undefined;
  }

  return decodeURIComponent(matchingCookie.slice(name.length + 1));
}
