export function validateBulkRequest(body) {
  const errors = [];

  if (!body || typeof body !== "object") {
    return ["Request body must be a JSON object"];
  }

  if (!body.parentId || String(body.parentId).trim() === "") {
    errors.push("parentId is required");
  }

  if (body.project !== undefined && String(body.project).trim() === "") {
    errors.push("project must not be empty");
  }

  if (!Array.isArray(body.tasks)) {
    errors.push("tasks must be an array");
    return errors;
  }

  if (body.tasks.length === 0) {
    errors.push("tasks must contain at least one task");
  }

  body.tasks.forEach((task, index) => {
    if (!task || typeof task !== "object") {
      errors.push(`tasks[${index}] must be an object`);
      return;
    }

    if (!task.title || String(task.title).trim() === "") {
      errors.push(`tasks[${index}].title is required`);
    }

    if (!task.description || String(task.description).trim() === "") {
      errors.push(`tasks[${index}].description is required`);
    }

    validateNonNegativeNumber(errors, task.remainingWork, `tasks[${index}].remainingWork`);
    validateNonNegativeNumber(errors, task.originalEstimate, `tasks[${index}].originalEstimate`);
    validateNonNegativeNumber(errors, task.originalEstimateHH, `tasks[${index}].originalEstimateHH`);
  });

  return errors;
}

export function normalizeTask(task) {
  const remainingWork = normalizeOptionalNumber(task.remainingWork);
  const explicitOriginalEstimate = normalizeOptionalNumber(
    task.originalEstimate ?? task.originalEstimateHH
  );

  return {
    title: String(task.title).trim(),
    description: task.description ? String(task.description).trim() : undefined,
    assignedTo: task.assignedTo ? String(task.assignedTo).trim() : undefined,
    areaPath: task.areaPath ? String(task.areaPath).trim() : undefined,
    iterationPath: task.iterationPath ? String(task.iterationPath).trim() : undefined,
    taskType: task.taskType ? String(task.taskType).trim() : undefined,
    activity: task.activity ? String(task.activity).trim() : undefined,
    remainingWork,
    originalEstimate: explicitOriginalEstimate ?? remainingWork,
    tags: Array.isArray(task.tags) ? task.tags.join("; ") : task.tags
  };
}

function validateNonNegativeNumber(errors, value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    errors.push(`${fieldName} must be a non-negative number`);
  }
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return Number(value);
}
