#!/usr/bin/env bun

import { readdir } from "node:fs/promises";

// Get args from command line
const args = process.argv.slice(2);
if (args.length == 0) {
  console.log("Usage:");
  console.log("  svails init <field>");
  console.log("  svails form <name> <field>:<type>");
  process.exit(1);
} else {
  // Get command
  const command = args[0];
  if (command == "init") {
    // Initialize svails template
    if (args.length < 3) {
      console.log("Usage:");
      console.log("  svails init <template> <name>");
      process.exit(1);
    }
    const { success } = Bun.spawnSync({
      cmd: ["git", "clone", `https://github.com/svails/${args[1]}`, args[2]],
      stdout: "inherit",
      stderr: "inherit",
    });
    if (!success) {
      console.error("Failed to clone the repository.");
      process.exit(1);
    }

    // Move the .git folder away
    Bun.spawnSync({
      cmd: ["mv", `${args[2]}/.git`, `/tmp/${crypto.randomUUID()}`],
    });

    // Replace Svails with uppercase name and svails* with lowercase name
    Bun.spawnSync({
      cmd: ["find", args[2], "-type", "f", "-exec", "sed", "-i", `s/Svails/${titleCase(args[2])}/g`, "{}", "+"],
    });
    Bun.spawnSync({
      cmd: ["find", args[2], "-type", "f", "!", "-name", "README.md", "-exec", "sed", "-i", `s/svails\\|svails-fullstack\\|svails-api/${args[2]}/g`, "{}", "+"],
    });
  } else if (command == "form") {
    // Create shadcn-svelte form
    if (args.length < 3) {
      console.log("Usage:");
      console.log("  svails form <name> <field>:<type>");
      process.exit(1);
    }
    await form(args[1], args.slice(2));
  } else {
    console.log("Unknown command:", args[0]);
    process.exit(1);
  }
}

function titleCase(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1);
}

// Generate shadcn-svelte form from fields
type Field = { field: string; type: string };

function renderInput({ field, type }: Field, name: string): string {
  if (type == "textarea") {
    return `<Textarea {...attrs} bind:value={$${name}Data.${field}} rows={4} />`;
  } else if (type == "files") {
    return `<Input {...attrs} bind:value={$${name}Data.${field}} type="file" multiple />`;
  } else {
    return `<Input {...attrs} bind:value={$${name}Data.${field}} type="${type}" />`;
  }
}

function renderField({ field, type }: Field, name: string): string {
  return `  <Form.Field form={${name}} name="${field}">
    <Form.Control let:attrs>
      <Form.Label>${titleCase(field)}</Form.Label>
      ${renderInput({ field, type }, name)}
    </Form.Control>
    <Form.FieldErrors />
  </Form.Field>`;
}

function renderHeader(renderedFields: string): string {
  let output = "";
  if (renderedFields.includes("Input")) {
    output += `  import { Input } from "$ui/input";\n`;
  }
  if (renderedFields.includes("Textarea")) {
    output += `  import { Textarea } from "$ui/textarea";\n`;
  }
  return output.trimEnd();
}

function renderFormType(renderedFields: string): string {
  if (renderedFields.includes(`type="file"`)) {
    return ` enctype="multipart/form-data"`
  } else {
    return ""
  }
}

function renderSchemaField({ field, type }: Field): string {
  if (type == "email") {
    return `  ${field}: z.string().email(),`;
  } else if (type == "password") {
    return `  ${field}: z.string().min(8, { message: "Password must be minimum 8 characters" }),`;
  } else if (type == "number") {
    return `  ${field}: z.number(),`;
  } else if (type == "file") {
    return `  ${field}: z.instanceof(File),`;
  } else if (type == "files") {
    return `  ${field}: z.array(z.instanceof(File)),`;
  } else if (type == "date") {
    return `  ${field}: z.date(),`;
  } else {
    return `  ${field}: z.string(),`;
  }
}

async function projectName(): Promise<string | null> {
  let folder = ".";
  for (let i = 0; i < 10; i++) {
    const files = await readdir(folder);
    if (files.includes("package.json")) {
      const file = Bun.file(`${folder}package.json`);
      const body = await file.text();
      const json = JSON.parse(body);
      return json["name"];
    }
    folder = folder == "." ? "../" : folder + "../";
  }
  return null;
}

async function renderTitle(name: string): Promise<string> {
  // Try and find name for project
  const project = await projectName();
  if (project) {
    return `${titleCase(name)} - ${titleCase(project)}`;
  } else {
    return `${titleCase(name)}`;
  }
}

async function form(name: string, args: string[]) {
  // Parse fields
  const fields = args.map<Field>(arg => {
    const [field, type] = arg.split(':');
    return { field, type };
  });

  // Generate +page.svelte
  const renderedFields = fields.map((field) => renderField(field, name)).join("\n\n");
  const renderedHeader = renderHeader(renderedFields);
  const pageSvelte = `<script lang="ts">
  import * as Form from "$ui/form";
${renderedHeader}
  import { superForm } from "sveltekit-superforms";
  import Loader from "lucide-svelte/icons/loader";

  // Props
  const { data } = $props();
  const ${name} = superForm(data.${name});
  const { form: ${name}Data, delayed: ${name}Delayed, submitting: ${name}Submitting, enhance: ${name}Enhance } = ${name};
</script>

<svelte:head>
  <title>${await renderTitle(name)}</title>
</svelte:head>

<h1 class="text-2xl font-bold mb-4">${titleCase(name)}</h1>

<form class="grid gap-2" method="post" action="?/${name}"${renderFormType(renderedFields)} use:${name}Enhance>
${renderedFields}

  <Form.Button disabled={$${name}Submitting}>
    {#if $${name}Delayed}
      <Loader class="animate-spin" />
    {:else}
      Submit
    {/if}
  </Form.Button>
</form>`;

  // Generate +page.server.ts
  const schemaName = `${name}Schema`;
  const renderedSchemaFields = fields.map(renderSchemaField).join("\n").trimEnd();
  const pageServer = `import { z } from "zod";
import { zod } from "sveltekit-superforms/adapters";
import { fail, superValidate } from "sveltekit-superforms";
import type { Actions, PageServerLoad } from "./$types";

const ${schemaName} = z.object({
${renderedSchemaFields}
});

export const load: PageServerLoad = async () => {
  // Initialize form
  return {
    ${name}: await superValidate(zod(${schemaName})),
  };
};

export const actions: Actions = {
  ${name}: async ({ request }) => {
    // Validate form
    const ${name} = await superValidate(request, zod(${schemaName}));
    if (!${name}.valid) return fail(400, { ${name} });
    const { ${fields.map(({ field }) => field).join(", ")} } = ${name}.data;
    console.log(${fields.map(({ field }) => field).join(", ")});
  },
};`;

  // Create files
  await Promise.all([
    Bun.write(`${name}/+page.svelte`, pageSvelte),
    Bun.write(`${name}/+page.server.ts`, pageServer),
  ]);
  console.log(`Created ${name}/+page.svelte`);
  console.log(`Created ${name}/+page.server.ts`);
}
