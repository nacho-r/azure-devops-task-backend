import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildProjectsApiUrl,
  buildTaskPatchDocument,
  createChildTask,
  buildWorkItemApiUrl,
  buildWorkItemReferenceUrl,
  listProjects
} from "../src/azureDevOpsClient.js";
import { normalizeTask, validateBulkRequest } from "../src/validation.js";

test("buildWorkItemApiUrl creates the Task endpoint", () => {
  assert.equal(
    buildWorkItemApiUrl({ org: "achsdev", project: "CRM" }),
    "https://dev.azure.com/achsdev/CRM/_apis/wit/workitems/%24Task?api-version=7.1"
  );
});

test("buildWorkItemReferenceUrl creates parent reference url", () => {
  assert.equal(
    buildWorkItemReferenceUrl({ org: "achsdev", project: "CRM", workItemId: "410960" }),
    "https://dev.azure.com/achsdev/CRM/_apis/wit/workItems/410960"
  );
});

test("buildProjectsApiUrl creates the projects endpoint", () => {
  assert.equal(
    buildProjectsApiUrl({ org: "achsdev" }),
    "https://dev.azure.com/achsdev/_apis/projects?api-version=7.1"
  );
});

test("buildTaskPatchDocument links the task to the parent", () => {
  const patch = buildTaskPatchDocument({
    org: "achsdev",
    project: "CRM",
    parentId: "410960",
    task: {
      title: "Crear validaciones",
      description: "Validar formulario",
      assignedTo: "usuario@empresa.com",
      remainingWork: 4,
      originalEstimate: 4,
      taskType: "Development",
      tags: "CRM; Automatizacion"
    }
  });

  assert.equal(patch[0].path, "/fields/System.Title");
  assert.equal(patch[0].value, "Crear validaciones");
  assert.deepEqual(
    patch.find((field) => field.path === "/fields/Microsoft.VSTS.Scheduling.OriginalEstimate"),
    {
      op: "add",
      path: "/fields/Microsoft.VSTS.Scheduling.OriginalEstimate",
      value: 4
    }
  );
  assert.deepEqual(patch.find((field) => field.path === "/fields/Microsoft.VSTS.CMMI.TaskType"), {
    op: "add",
    path: "/fields/Microsoft.VSTS.CMMI.TaskType",
    value: "Development"
  });

  const relation = patch.at(-1);
  assert.equal(relation.path, "/relations/-");
  assert.equal(relation.value.rel, "System.LinkTypes.Hierarchy-Reverse");
  assert.equal(
    relation.value.url,
    "https://dev.azure.com/achsdev/CRM/_apis/wit/workItems/410960"
  );
});

test("validateBulkRequest validates required fields", () => {
  assert.deepEqual(validateBulkRequest({ parentId: "", tasks: [] }), [
    "parentId is required",
    "tasks must contain at least one task"
  ]);

  assert.deepEqual(validateBulkRequest({ parentId: "410960", tasks: [{ title: "" }] }), [
    "tasks[0].title is required",
    "tasks[0].description is required"
  ]);
});

test("validateBulkRequest rejects empty project when provided", () => {
  assert.deepEqual(validateBulkRequest({ project: " ", parentId: "410960", tasks: [] }), [
    "project must not be empty",
    "tasks must contain at least one task"
  ]);
});

test("validateBulkRequest validates original estimate aliases", () => {
  assert.deepEqual(
    validateBulkRequest({
      parentId: "410960",
      tasks: [{ title: "Task", description: "Detalle", originalEstimateHH: -1 }]
    }),
    ["tasks[0].originalEstimateHH must be a non-negative number"]
  );
});

test("normalizeTask defaults originalEstimate to remainingWork", () => {
  assert.deepEqual(normalizeTask({ title: "Task", description: "Detalle", remainingWork: "6" }), {
    title: "Task",
    description: "Detalle",
    assignedTo: undefined,
    taskType: undefined,
    remainingWork: 6,
    originalEstimate: 6,
    tags: undefined
  });
});

test("createChildTask returns only sanitized Azure fields", async () => {
  const result = await createChildTask({
    org: "achsdev",
    project: "CRM",
    pat: "fake-pat",
    parentId: "410960",
    task: {
      title: "Task",
      description: "Detalle"
    },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          id: 123,
          rev: 4,
          fields: {
            "System.Title": "Task"
          },
          _links: {
            html: {
              href: "https://example.test/task/123"
            }
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
  });

  assert.deepEqual(result, {
    id: 123,
    url: "https://example.test/task/123"
  });
});

test("listProjects returns only sanitized project fields", async () => {
  const result = await listProjects({
    org: "achsdev",
    pat: "fake-pat",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          count: 1,
          value: [
            {
              id: "project-id",
              name: "CRM",
              state: "wellFormed",
              visibility: "private",
              url: "https://example.test/raw-project-url"
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
  });

  assert.deepEqual(result, [
    {
      id: "project-id",
      name: "CRM",
      state: "wellFormed",
      visibility: "private"
    }
  ]);
});
