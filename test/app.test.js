import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDryRunTaskResults,
  chooseInheritedClassificationPath,
  summarizeCreateError
} from "../src/app.js";

test("buildDryRunTaskResults returns only sanitized validation results", () => {
  const results = buildDryRunTaskResults([
    {
      title: "Task",
      description: "Detalle",
      taskType: "Development",
      remainingWork: 4,
      originalEstimateHH: 4
    }
  ]);

  assert.deepEqual(results, [
    {
      index: 0,
      status: "validated",
      title: "Task"
    }
  ]);

  const serializedResults = JSON.stringify(results);
  assert.equal(serializedResults.includes("patchDocument"), false);
  assert.equal(serializedResults.includes("Custom.TasktypeDev"), false);
  assert.equal(serializedResults.includes("Description"), false);
});

test("summarizeCreateError does not expose raw Azure error details", () => {
  const error = new Error(
    "TF401320: Rule Error for field Description. Error code: Required, InvalidEmpty."
  );
  error.status = 400;
  error.azureResponse = {
    fields: {
      "System.Description": ""
    }
  };

  const summary = summarizeCreateError(error);

  assert.equal(summary, "Azure DevOps rechazo la task por campos requeridos o vacios.");
  assert.equal(summary.includes("TF401320"), false);
  assert.equal(summary.includes("System.Description"), false);
});

test("chooseInheritedClassificationPath keeps specific fallback when fetched path is project root", () => {
  assert.equal(
    chooseInheritedClassificationPath("CRM", "CRM\\Playbook-CO-SF", "CRM"),
    "CRM\\Playbook-CO-SF"
  );
  assert.equal(
    chooseInheritedClassificationPath("CRM\\Playbook-CO-SF", "CRM\\Otro", "CRM"),
    "CRM\\Playbook-CO-SF"
  );
  assert.equal(chooseInheritedClassificationPath("", "CRM\\Otro", "CRM"), "CRM\\Otro");
});
