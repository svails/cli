#!/usr/bin/env bun

// Get args from command line
const args = process.argv.slice(2);
if (args.length == 0) {
  console.log("Usage:");
  console.log("  svails init <name>");
  console.log("  svails form <fields>");
  process.exit(1);
} else {
  // Get command
  const command = args[0];
  if (command == "init") {
    // Initialize svails template
    if (args.length < 2) {
      console.log("Usage:");
      console.log("  svails init <name>");
      process.exit(1);
    }
    const { success } = Bun.spawnSync({
      cmd: ["git", "clone", "https://github.com/svails/svails", args[1]],
      stdout: "inherit",
      stderr: "inherit",
    });
    if (!success) {
      console.error("Failed to clone the repository.");
      process.exit(1);
    }
  } else if (command == "form") {
    // Create shadcn-svelte form
    if (args.length < 1) {
      console.log("Usage:");
      console.log("  svails form <name>:<type>");
      process.exit(1);
    }
    await form(args.slice(1));
  } else {
    console.log("Unknown command:", args[0]);
    process.exit(1);
  }
}

// Generate shadcn-svelte form from fields
type Field = { name: string; type: string };

function renderInput({ name, type }: Field): string {
  if (type == "textarea") {
    return `<Textarea {...attrs} bind:value={$formData.${name}} rows={4} />`;
  } else if (type == "files") {
    return `<Input {...attrs} bind:value={$formData.${name}} type="file" multiple />`;
  } else {
    return `<Input {...attrs} bind:value={$formData.${name}} type="${type}" />`;
  }
}

function renderField({ name, type }: Field): string {
  return `  <Form.Field {form} name="${name}">
    <Form.Control let:attrs>
      <Form.Label>${name.charAt(0).toUpperCase() + name.slice(1)}</Form.Label>
      ${renderInput({ name, type })}
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

function renderSchemaField({ name, type }: Field): string {
  if (type == "email") {
    return `  ${name}: z.string().email(),`;
  } else if (type == "password") {
    return `  ${name}: z.string().min(8, { message: "Password must be minimum 8 characters" }),`;
  } else if (type == "number") {
    return `  ${name}: z.number(),`;
  } else if (type == "file") {
    return `  ${name}: z.instanceof(File),`;
  } else if (type == "files") {
    return `  ${name}: z.array(z.instanceof(File)),`;
  } else {
    return `  ${name}: z.string(),`;
  }
}

async function form(args: string[]) {
  // Parse fields
  const fields = args.map<Field>(arg => {
    const [name, type] = arg.split(':');
    return { name, type };
  });

  // Generate +page.svelte
  const renderedFields = fields.map(renderField).join("\n\n");
  const renderedHeader = renderHeader(renderedFields);
  const pageSvelte = `<script lang="ts">
  import * as Form from "$ui/form";
${renderedHeader}
  import { superForm } from "sveltekit-superforms";
  import Loader from "lucide-svelte/icons/loader";

  // Props
  const { data } = $props();
  const form = superForm(data.form);
  const { form: formData, delayed, submitting, enhance } = form;
</script>

<form class="grid gap-2" method="post"${renderFormType(renderedFields)} use:enhance>
${renderedFields}

  <Form.Button disabled={$submitting}>
    {#if $delayed}
      <Loader class="animate-spin" />
    {:else}
      Submit
    {/if}
  </Form.Button>
</form>`;

  // Generate +page.server.ts
  const renderedSchemaFields = fields.map(renderSchemaField).join("\n").trimEnd();
  const pageServer = `import type { Actions, PageServerLoad } from "./$types";
import { z } from "zod";
import { zod } from "sveltekit-superforms/adapters";
import { fail, superValidate } from "sveltekit-superforms";

const schema = z.object({
${renderedSchemaFields}
});

export const load: PageServerLoad = async () => {
  // Initialize form
  return {
    form: await superValidate(zod(schema)),
  };
};

export const actions: Actions = {
  default: async ({ request }) => {
    // Validate form
    const form = await superValidate(request, zod(schema));
    if (!form.valid) return fail(400, { form });
    const { ${fields.map(field => field.name).join(", ")} } = form.data;

    // Business logic
  },
};`;

  // Create files
  await Promise.all([
    Bun.write("+page.svelte", pageSvelte),
    Bun.write("+page.server.ts", pageServer),
  ]);
  console.log(`Created +page.svelte`);
  console.log(`Created +page.server.ts`);
}
