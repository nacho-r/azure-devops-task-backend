const API_VERSION = "7.1";
const TASK_WORK_ITEM_TYPE = "Task";
const PARENT_RELATION_TYPE = "System.LinkTypes.Hierarchy-Reverse";
const DEFAULT_TASK_TYPE_FIELD = "Microsoft.VSTS.CMMI.TaskType";

export function buildWorkItemApiUrl({ org, project, workItemType = TASK_WORK_ITEM_TYPE }) {
  assertConfig({ org, project });

  const encodedProject = encodeURIComponent(project);
  const encodedWorkItemType = encodeURIComponent(`$${workItemType}`);

  return `https://dev.azure.com/${org}/${encodedProject}/_apis/wit/workitems/${encodedWorkItemType}?api-version=${API_VERSION}`;
}

export function buildWorkItemReferenceUrl({ org, project, workItemId }) {
  assertConfig({ org, project });

  if (!workItemId) {
    throw new Error("workItemId is required");
  }

  const encodedProject = encodeURIComponent(project);
  return `https://dev.azure.com/${org}/${encodedProject}/_apis/wit/workItems/${workItemId}`;
}

export function buildWorkItemDetailsApiUrl({ org, project, workItemId, fields = [] }) {
  assertConfig({ org, project });

  if (!workItemId) {
    throw new Error("workItemId is required");
  }

  const encodedProject = encodeURIComponent(project);
  const params = new URLSearchParams({
    "api-version": API_VERSION
  });

  if (fields.length > 0) {
    params.set("fields", fields.join(","));
  }

  return `https://dev.azure.com/${org}/${encodedProject}/_apis/wit/workitems/${encodeURIComponent(
    workItemId
  )}?${params.toString()}`;
}


export function buildFieldsApiUrl({ org, project }) {
  assertConfig({ org, project });

  const encodedProject = encodeURIComponent(project);
  return `https://dev.azure.com/${org}/${encodedProject}/_apis/wit/fields?api-version=${API_VERSION}`;
}

export function buildProjectsApiUrl({ org }) {
  assertOrg({ org });

  return `https://dev.azure.com/${org}/_apis/projects?api-version=${API_VERSION}`;
}

export function buildClassificationNodesApiUrl({ org, project, structureGroup, depth = 10 }) {
  assertConfig({ org, project });

  const encodedProject = encodeURIComponent(project);
  const encodedGroup = encodeURIComponent(structureGroup);
  return `https://dev.azure.com/${org}/${encodedProject}/_apis/wit/classificationnodes/${encodedGroup}?$depth=${encodeURIComponent(
    depth
  )}&api-version=${API_VERSION}`;
}

export function buildWiqlApiUrl({ org, project, top = 10 }) {
  assertConfig({ org, project });

  const encodedProject = encodeURIComponent(project);
  return `https://dev.azure.com/${org}/${encodedProject}/_apis/wit/wiql?$top=${encodeURIComponent(
    top
  )}&api-version=${API_VERSION}`;
}

export function buildWorkItemsListApiUrl({ org, project, ids, fields = [] }) {
  assertConfig({ org, project });

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("ids are required");
  }

  const encodedProject = encodeURIComponent(project);
  const params = new URLSearchParams({
    ids: ids.join(","),
    "api-version": API_VERSION
  });

  if (fields.length > 0) {
    params.set("fields", fields.join(","));
  }

  return `https://dev.azure.com/${org}/${encodedProject}/_apis/wit/workitems?${params.toString()}`;
}

export function buildTaskPatchDocument({
  org,
  project,
  parentId,
  task,
  taskTypeField = DEFAULT_TASK_TYPE_FIELD
}) {
  if (!parentId) {
    throw new Error("parentId is required");
  }

  if (!task?.title?.trim()) {
    throw new Error("task.title is required");
  }

  const patch = [
    {
      op: "add",
      path: "/fields/System.Title",
      value: task.title.trim()
    }
  ];

  addOptionalField(patch, "/fields/System.Description", task.description);
  addOptionalField(patch, "/fields/System.AreaPath", task.areaPath);
  addOptionalField(patch, "/fields/System.IterationPath", task.iterationPath);
  addOptionalField(patch, "/fields/System.AssignedTo", task.assignedTo);
  addOptionalField(patch, "/fields/Microsoft.VSTS.Scheduling.RemainingWork", task.remainingWork);
  addOptionalField(
    patch,
    "/fields/Microsoft.VSTS.Scheduling.OriginalEstimate",
    task.originalEstimate
  );
  addOptionalField(patch, `/fields/${taskTypeField}`, task.taskType);
  addOptionalField(patch, "/fields/System.Tags", task.tags);

  patch.push({
    op: "add",
    path: "/relations/-",
    value: {
      rel: PARENT_RELATION_TYPE,
      url: buildWorkItemReferenceUrl({ org, project, workItemId: parentId }),
      attributes: {
        comment: "Creada automaticamente desde herramienta interna"
      }
    }
  });

  return patch;
}

export async function createChildTask({
  org,
  project,
  pat,
  parentId,
  task,
  taskTypeField = DEFAULT_TASK_TYPE_FIELD,
  fetchImpl = fetch
}) {
  assertConfig({ org, project });

  if (!pat) {
    throw new Error("PAT is required when dryRun is false");
  }

  const patchDocument = buildTaskPatchDocument({ org, project, parentId, task, taskTypeField });
  const response = await fetchImpl(buildWorkItemApiUrl({ org, project }), {
    method: "POST",
    headers: {
      Authorization: buildBasicAuthHeader(pat),
      "Content-Type": "application/json-patch+json"
    },
    body: JSON.stringify(patchDocument)
  });

  const body = await readJsonSafely(response);

  if (!response.ok) {
    const message = body?.message || body?.error?.message || `Azure DevOps returned ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.azureResponse = body;
    throw error;
  }

  return {
    id: body.id,
    url: body._links?.html?.href || body.url
  };
}

export async function listFields({ org, project, pat, search, fetchImpl = fetch }) {
  assertConfig({ org, project });

  if (!pat) {
    throw new Error("PAT is required to list Azure DevOps fields");
  }

  const response = await fetchImpl(buildFieldsApiUrl({ org, project }), {
    method: "GET",
    headers: {
      Authorization: buildBasicAuthHeader(pat),
      Accept: "application/json"
    }
  });

  const body = await readJsonSafely(response);

  if (!response.ok) {
    const message = body?.message || body?.error?.message || `Azure DevOps returned ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.azureResponse = body;
    throw error;
  }

  const fields = body?.value || [];
  const normalizedSearch = search ? String(search).toLowerCase().trim() : "";
  const filteredFields = normalizedSearch
    ? fields.filter((field) =>
        [field.name, field.referenceName, field.description]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch))
      )
    : fields;

  return filteredFields.map((field) => ({
    name: field.name,
    referenceName: field.referenceName,
    type: field.type,
    readOnly: field.readOnly,
    supportedOperations: field.supportedOperations?.map((operation) => operation.name)
  }));
}

export async function listProjects({ org, pat, fetchImpl = fetch }) {
  assertOrg({ org });

  if (!pat) {
    throw new Error("PAT is required to list Azure DevOps projects");
  }

  const response = await fetchImpl(buildProjectsApiUrl({ org }), {
    method: "GET",
    headers: {
      Authorization: buildBasicAuthHeader(pat),
      Accept: "application/json"
    }
  });

  const body = await readJsonSafely(response);

  if (!response.ok) {
    const message = body?.message || body?.error?.message || `Azure DevOps returned ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.azureResponse = body;
    throw error;
  }

  return (body?.value || []).map((project) => ({
    id: project.id,
    name: project.name,
    state: project.state,
    visibility: project.visibility
  }));
}

export async function listClassificationNodes({
  org,
  project,
  pat,
  structureGroup,
  search,
  limit = 50,
  depth = 10,
  fetchImpl = fetch
}) {
  assertConfig({ org, project });

  if (!["Areas", "Iterations"].includes(structureGroup)) {
    throw new Error("structureGroup must be Areas or Iterations");
  }

  if (!pat) {
    throw new Error("PAT is required to list Azure DevOps classification nodes");
  }

  const response = await fetchImpl(
    buildClassificationNodesApiUrl({ org, project, structureGroup, depth }),
    {
      method: "GET",
      headers: {
        Authorization: buildBasicAuthHeader(pat),
        Accept: "application/json"
      }
    }
  );

  const body = await readJsonSafely(response);

  if (!response.ok) {
    const message = body?.message || body?.error?.message || `Azure DevOps returned ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.azureResponse = body;
    throw error;
  }

  const nodes = flattenClassificationNodes(body);
  const normalizedSearch = search ? String(search).toLowerCase().trim() : "";
  const filteredNodes = normalizedSearch
    ? nodes.filter((node) =>
        [node.name, node.path]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch))
      )
    : nodes;

  return filteredNodes.slice(0, limit);
}

export async function searchWorkItemsByIdPrefix({
  org,
  project,
  pat,
  idPrefix,
  top = 10,
  fetchImpl = fetch
}) {
  assertConfig({ org, project });

  if (!pat) {
    throw new Error("PAT is required to search Azure DevOps work items");
  }

  const range = buildWorkItemIdPrefixRange(idPrefix);

  if (!range) {
    return [];
  }

  const wiqlResponse = await fetchImpl(buildWiqlApiUrl({ org, project, top }), {
    method: "POST",
    headers: {
      Authorization: buildBasicAuthHeader(pat),
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      query: [
        "SELECT [System.Id]",
        "FROM WorkItems",
        `WHERE [System.TeamProject] = '${escapeWiqlString(project)}'`,
        `AND [System.Id] >= ${range.min}`,
        `AND [System.Id] <= ${range.max}`,
        "AND [System.State] <> 'Removed'",
        "ORDER BY [System.Id] ASC"
      ].join(" ")
    })
  });

  const wiqlBody = await readJsonSafely(wiqlResponse);

  if (!wiqlResponse.ok) {
    const message =
      wiqlBody?.message || wiqlBody?.error?.message || `Azure DevOps returned ${wiqlResponse.status}`;
    const error = new Error(message);
    error.status = wiqlResponse.status;
    error.azureResponse = wiqlBody;
    throw error;
  }

  const ids = (wiqlBody?.workItems || []).map((workItem) => workItem.id).filter(Boolean);

  if (ids.length === 0) {
    return [];
  }

  const workItemsResponse = await fetchImpl(
    buildWorkItemsListApiUrl({
      org,
      project,
      ids,
      fields: [
        "System.Id",
        "System.Title",
        "System.WorkItemType",
        "System.State",
        "System.AreaPath",
        "System.IterationPath"
      ]
    }),
    {
      method: "GET",
      headers: {
        Authorization: buildBasicAuthHeader(pat),
        Accept: "application/json"
      }
    }
  );

  const workItemsBody = await readJsonSafely(workItemsResponse);

  if (!workItemsResponse.ok) {
    const message =
      workItemsBody?.message ||
      workItemsBody?.error?.message ||
      `Azure DevOps returned ${workItemsResponse.status}`;
    const error = new Error(message);
    error.status = workItemsResponse.status;
    error.azureResponse = workItemsBody;
    throw error;
  }

  return (workItemsBody?.value || []).map((workItem) => ({
    id: workItem.id,
    title: workItem.fields?.["System.Title"] || "",
    type: workItem.fields?.["System.WorkItemType"] || "",
    state: workItem.fields?.["System.State"] || "",
    areaPath: workItem.fields?.["System.AreaPath"] || "",
    iterationPath: workItem.fields?.["System.IterationPath"] || "",
    url: workItem._links?.html?.href
  }));
}

export async function getWorkItemClassification({
  org,
  project,
  pat,
  workItemId,
  fetchImpl = fetch
}) {
  assertConfig({ org, project });

  if (!workItemId) {
    throw new Error("workItemId is required");
  }

  if (!pat) {
    throw new Error("PAT is required to read Azure DevOps work item classification");
  }

  const response = await fetchImpl(
    buildWorkItemDetailsApiUrl({
      org,
      project,
      workItemId,
      fields: ["System.AreaPath", "System.IterationPath"]
    }),
    {
      method: "GET",
      headers: {
        Authorization: buildBasicAuthHeader(pat),
        Accept: "application/json"
      }
    }
  );

  const body = await readJsonSafely(response);

  if (!response.ok) {
    const message = body?.message || body?.error?.message || `Azure DevOps returned ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.azureResponse = body;
    throw error;
  }

  const workItem = body?.id ? body : undefined;

  if (!workItem) {
    const error = new Error("Work item not found");
    error.status = 404;
    throw error;
  }

  return {
    areaPath: workItem.fields?.["System.AreaPath"] || undefined,
    iterationPath: workItem.fields?.["System.IterationPath"] || undefined
  };
}

export function buildWorkItemIdPrefixRange(idPrefix, idLength = 6) {
  const normalizedPrefix = String(idPrefix || "").trim();

  if (!/^\d+$/.test(normalizedPrefix)) {
    return null;
  }

  if (normalizedPrefix.length >= idLength) {
    const id = Number(normalizedPrefix);
    return { min: id, max: id };
  }

  return {
    min: Number(normalizedPrefix.padEnd(idLength, "0")),
    max: Number(normalizedPrefix.padEnd(idLength, "9"))
  };
}

export function flattenClassificationNodes(rootNode) {
  const nodes = [];

  function visit(node, parentPath) {
    if (!node?.name) {
      return;
    }

    const path = parentPath ? `${parentPath}\\${node.name}` : node.name;

    nodes.push({
      id: node.id,
      name: node.name,
      path,
      structureType: node.structureType,
      hasChildren: Boolean(node.hasChildren),
      startDate: node.attributes?.startDate,
      finishDate: node.attributes?.finishDate
    });

    (node.children || []).forEach((child) => visit(child, path));
  }

  visit(rootNode, "");
  return nodes;
}

export function buildBasicAuthHeader(pat) {
  return `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
}

function escapeWiqlString(value) {
  return String(value).replace(/'/g, "''");
}

function addOptionalField(patch, path, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  patch.push({
    op: "add",
    path,
    value
  });
}

function assertConfig({ org, project }) {
  assertOrg({ org });

  if (!project) {
    throw new Error("AZURE_DEVOPS_PROJECT is required");
  }
}

function assertOrg({ org }) {
  if (!org) {
    throw new Error("AZURE_DEVOPS_ORG is required");
  }
}

async function readJsonSafely(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
