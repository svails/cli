#!/usr/bin/env bun

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

// Generate shadcn-svelte form from fields
type Field = { field: string; type: string };

function renderInput({ field, type }: Field, name: string): string {
  if (type == "textarea") {
    return `<Textarea {...attrs} bind:value={$${name}.form.${field}} rows={4} />`;
  } else if (type == "files") {
    return `<Input {...attrs} bind:value={$${name}.form.${field}} type="file" multiple />`;
  } else {
    return `<Input {...attrs} bind:value={$${name}.form.${field}} type="${field}" />`;
  }
}

function renderField({ field, type }: Field, name: string): string {
  return `  <Form.Field form={${name}} field="${field}">
    <Form.Control let:attrs>
      <Form.Label>${field.charAt(0).toUpperCase() + field.slice(1)}</Form.Label>
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
  } else {
    return `  ${field}: z.string(),`;
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
</script>

<h1 class="text-xl font-bold mb-4">${name.charAt(0).toUpperCase() + name.slice(1)}</h1>

<form class="grid gap-2" method="post"${renderFormType(renderedFields)} use:enhance={${name}.enhance}>
${renderedFields}

  <Form.Button disabled={$${name}.submitting}>
    {#if $${name}.delayed}
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
import { type Actions, type PageServerLoad } from "./$types";

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
  default: async ({ request }) => {
    // Validate form
    const ${name} = await superValidate(request, zod(${schemaName}));
    if (!${name}.valid) return fail(400, { form: ${name} });
    const { ${fields.map(({ field }) => field).join(", ")} } = ${name}.data;

    // Business logic
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
