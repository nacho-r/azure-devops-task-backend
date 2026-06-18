import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildClassificationNodesApiUrl,
  buildProjectsApiUrl,
  buildTaskPatchDocument,
  createChildTask,
  buildWiqlApiUrl,
  buildWorkItemsListApiUrl,
  buildWorkItemIdPrefixRange,
  flattenClassificationNodes,
  getWorkItemClassification,
  buildWorkItemApiUrl,
  buildWorkItemReferenceUrl,
  listProjects,
  searchWorkItemsByIdPrefix
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

test("buildClassificationNodesApiUrl creates the classification nodes endpoint", () => {
  assert.equal(
    buildClassificationNodesApiUrl({
      org: "achsdev",
      project: "CRM",
      structureGroup: "Areas",
      depth: 10
    }),
    "https://dev.azure.com/achsdev/CRM/_apis/wit/classificationnodes/Areas?$depth=10&api-version=7.1"
  );
});

test("buildWiqlApiUrl creates the WIQL endpoint", () => {
  assert.equal(
    buildWiqlApiUrl({ org: "achsdev", project: "CRM", top: 10 }),
    "https://dev.azure.com/achsdev/CRM/_apis/wit/wiql?$top=10&api-version=7.1"
  );
});

test("buildWorkItemsListApiUrl creates the work items list endpoint", () => {
  assert.equal(
    buildWorkItemsListApiUrl({
      org: "achsdev",
      project: "CRM",
      ids: [415192],
      fields: ["System.Id", "System.Title"]
    }),
    "https://dev.azure.com/achsdev/CRM/_apis/wit/workitems?ids=415192&api-version=7.1&fields=System.Id%2CSystem.Title"
  );
});

test("buildWorkItemIdPrefixRange creates a six digit id range", () => {
  assert.deepEqual(buildWorkItemIdPrefixRange("4151"), {
    min: 415100,
    max: 415199
  });
  assert.deepEqual(buildWorkItemIdPrefixRange("415192"), {
    min: 415192,
    max: 415192
  });
  assert.equal(buildWorkItemIdPrefixRange("abc"), null);
});

test("flattenClassificationNodes returns sanitized full paths", () => {
  assert.deepEqual(
    flattenClassificationNodes({
      id: 1,
      name: "CRM",
      structureType: "area",
      hasChildren: true,
      children: [
        {
          id: 2,
          name: "Playbook-CO-SF",
          structureType: "area",
          hasChildren: false
        }
      ]
    }),
    [
      {
        id: 1,
        name: "CRM",
        path: "CRM",
        structureType: "area",
        hasChildren: true,
        startDate: undefined,
        finishDate: undefined
      },
      {
        id: 2,
        name: "Playbook-CO-SF",
        path: "CRM\\Playbook-CO-SF",
        structureType: "area",
        hasChildren: false,
        startDate: undefined,
        finishDate: undefined
      }
    ]
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
      areaPath: "CRM\\Playbook-CO-SF",
      iterationPath: "CRM\\ContinuidadCSF\\Sprint 11",
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
  assert.deepEqual(patch.find((field) => field.path === "/fields/System.AreaPath"), {
    op: "add",
    path: "/fields/System.AreaPath",
    value: "CRM\\Playbook-CO-SF"
  });
  assert.deepEqual(patch.find((field) => field.path === "/fields/System.IterationPath"), {
    op: "add",
    path: "/fields/System.IterationPath",
    value: "CRM\\ContinuidadCSF\\Sprint 11"
  });
  assert.deepEqual(patch.find((field) => field.path === "/fields/System.AssignedTo"), {
    op: "add",
    path: "/fields/System.AssignedTo",
    value: "usuario@empresa.com"
  });
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
    areaPath: undefined,
    iterationPath: undefined,
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

test("searchWorkItemsByIdPrefix returns only sanitized work item fields", async () => {
  const requests = [];
  const result = await searchWorkItemsByIdPrefix({
    org: "achsdev",
    project: "CRM",
    pat: "fake-pat",
    idPrefix: "4151",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });

      if (String(url).includes("/_apis/wit/wiql")) {
        return new Response(
          JSON.stringify({
            workItems: [{ id: 415192 }]
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      return new Response(
        JSON.stringify({
          value: [
            {
              id: 415192,
              rev: 2,
              fields: {
                "System.Title": "Gestion de grupos",
                "System.WorkItemType": "User Story",
                "System.State": "Active",
                "System.Description": "No debe salir"
              },
              _links: {
                html: {
                  href: "https://example.test/work-item/415192"
                }
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
  });

  assert.equal(requests.length, 2);
  assert.match(requests[0].options.body, /System.Id\] >= 415100/);
  assert.match(requests[0].options.body, /System.Id\] <= 415199/);
  assert.deepEqual(result, [
    {
      id: 415192,
      title: "Gestion de grupos",
      type: "User Story",
      state: "Active",
      url: "https://example.test/work-item/415192"
    }
  ]);
});

test("getWorkItemClassification returns parent area and iteration only", async () => {
  const requests = [];
  const result = await getWorkItemClassification({
    org: "achsdev",
    project: "CRM",
    pat: "fake-pat",
    workItemId: "415192",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });

      return new Response(
        JSON.stringify({
          value: [
            {
              id: 415192,
              fields: {
                "System.AreaPath": "CRM\\Playbook-CO-SF",
                "System.IterationPath": "CRM\\ContinuidadCSF\\Sprint 11",
                "System.Title": "No debe salir"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
  });

  assert.equal(requests.length, 1);
  assert.match(String(requests[0].url), /fields=System.AreaPath%2CSystem.IterationPath/);
  assert.deepEqual(result, {
    areaPath: "CRM\\Playbook-CO-SF",
    iterationPath: "CRM\\ContinuidadCSF\\Sprint 11"
  });
});
