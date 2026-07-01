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

test("summarizeCreateError explains invalid assigned user errors", () => {
  const error = new Error("The identity value for field 'Assigned To' is an unknown identity.");
  error.status = 400;

  assert.equal(
    summarizeCreateError(error),
    "Azure DevOps no reconoce el usuario asignado. Revisa el correo o deja Asignado a vacio."
  );
});

test("summarizeCreateError explains invalid task type values", () => {
  const error = new Error(
    "The field 'Custom.TasktypeDev' contains the value 'Desarrollo' that is not in the list of supported values."
  );
  error.status = 400;

  assert.equal(
    summarizeCreateError(error),
    "El tipo de tarea no es valido para el campo configurado en Azure DevOps."
  );
});

test("summarizeCreateError explains invalid classification paths", () => {
  const areaError = new Error("TF401347: Invalid tree name given for work item - System.AreaPath.");
  areaError.status = 400;
  const iterationError = new Error(
    "TF401347: Invalid tree name given for work item - System.IterationPath."
  );
  iterationError.status = 400;

  assert.equal(
    summarizeCreateError(areaError),
    "El area seleccionada no existe o no es valida para el proyecto."
  );
  assert.equal(
    summarizeCreateError(iterationError),
    "La iteracion seleccionada no existe o no es valida para el proyecto."
  );
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
