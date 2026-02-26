#!/usr/bin/env node

/**
 * Retools AI Driver
 *
 * Uses Claude API to apply AI-powered changes to a codebase.
 * This is a simplified version focused on PR generation (no deployment logic).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Parse command line arguments
const args = process.argv.slice(2);
const promptIndex = args.indexOf('--prompt');
const workingDirIndex = args.indexOf('--working-dir');
const fixMode = args.includes('--fix-mode');

if (promptIndex === -1 || workingDirIndex === -1) {
  console.error('Usage: ai-driver.js --prompt "..." --working-dir /path/to/repo [--fix-mode]');
  process.exit(1);
}

const prompt = args[promptIndex + 1];
const workingDir = args[workingDirIndex + 1];

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY environment variable not set');
  process.exit(1);
}

console.log('🤖 Retools AI Driver');
console.log('📁 Working directory:', workingDir);
console.log('🔧 Fix mode:', fixMode ? 'ENABLED (fixing build errors)' : 'DISABLED (initial changes)');
console.log('💬 Prompt:', prompt.substring(0, 100) + '...');

// Change to working directory
process.chdir(workingDir);

/**
 * Scan the repository to build context
 */
function scanRepository() {
  console.log('\n📊 Scanning repository...');

  const files = [];
  const maxFiles = 50; // Limit to avoid token overflow

  function scanDir(dir, depth = 0) {
    if (depth > 3) return; // Limit depth

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(workingDir, fullPath);

      // Skip common ignore patterns
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === '__pycache__'
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        scanDir(fullPath, depth + 1);
      } else if (entry.isFile() && files.length < maxFiles) {
        // Only include source files
        const ext = path.extname(entry.name);
        if (
          [
            '.js',
            '.ts',
            '.jsx',
            '.tsx',
            '.py',
            '.rb',
            '.go',
            '.rs',
            '.java',
            '.svelte',
            '.vue',
            '.css',
            '.html',
            '.json',
            '.md',
          ].includes(ext)
        ) {
          files.push(relativePath);
        }
      }
    }
  }

  scanDir(workingDir);

  console.log(`✅ Found ${files.length} source files`);
  return files;
}

/**
 * Read a file safely, returning empty string if it doesn't exist or is too large
 */
function safeReadFile(filePath, maxBytes = 8000) {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workingDir, filePath);
    if (!fs.existsSync(fullPath)) return '';
    const stat = fs.statSync(fullPath);
    if (stat.size > maxBytes) {
      // Read only the first maxBytes
      const buf = Buffer.alloc(maxBytes);
      const fd = fs.openSync(fullPath, 'r');
      fs.readSync(fd, buf, 0, maxBytes, 0);
      fs.closeSync(fd);
      return buf.toString('utf-8') + '\n... [truncated]';
    }
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Find files matching patterns (glob-lite)
 */
function findFiles(fileList, patterns) {
  return fileList.filter((f) => patterns.some((p) => {
    if (p.startsWith('*')) return f.endsWith(p.slice(1));
    if (p.endsWith('*')) return f.startsWith(p.slice(0, -1));
    return f === p || f.endsWith('/' + p) || f.includes(p);
  }));
}

/**
 * Extract branding context — README, styles, config, layouts, key components
 */
function extractBrandingContext(files) {
  console.log('🎨 Extracting branding & style context...');

  const branding = {};

  // 1. README — project name, purpose, identity
  const readmePatterns = ['README.md', 'readme.md', 'Readme.md'];
  for (const p of readmePatterns) {
    const content = safeReadFile(p, 4000);
    if (content) {
      branding.readme = content;
      console.log('  📄 Found README.md');
      break;
    }
  }

  // 2. Tailwind config — color palette, fonts, theme
  const tailwindMatches = findFiles(files, [
    'tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs', 'tailwind.config.cjs',
  ]);
  for (const f of tailwindMatches) {
    const content = safeReadFile(f);
    if (content) {
      branding.tailwindConfig = content;
      console.log(`  🎨 Found tailwind config: ${f}`);
      break;
    }
  }

  // 3. Global CSS — base styles, custom properties, color variables
  const cssPatterns = [
    'app.css', 'globals.css', 'global.css', 'index.css', 'main.css',
    'styles/globals.css', 'styles/global.css', 'src/app.css', 'src/index.css',
    'src/styles/globals.css', 'app/globals.css', 'app/layout.css',
  ];
  const cssMatches = findFiles(files, cssPatterns);
  for (const f of cssMatches) {
    const content = safeReadFile(f);
    if (content) {
      branding.globalCSS = content;
      console.log(`  🎨 Found global CSS: ${f}`);
      break;
    }
  }

  // 4. Layout files — app shell, navbar, header, footer
  const layoutPatterns = [
    '+layout.svelte', 'layout.svelte',
    'app/layout.tsx', 'app/layout.jsx', 'app/layout.js',
    '_app.tsx', '_app.jsx', '_app.js',
    'App.vue', 'App.svelte', 'App.tsx', 'App.jsx',
  ];
  const layoutMatches = findFiles(files, layoutPatterns);
  const layoutContents = [];
  for (const f of layoutMatches.slice(0, 2)) {
    const content = safeReadFile(f, 6000);
    if (content) {
      layoutContents.push({ path: f, content });
      console.log(`  🏗️  Found layout: ${f}`);
    }
  }
  if (layoutContents.length) branding.layouts = layoutContents;

  // 5. Navbar / Header components
  const navPatterns = [
    'Navbar', 'navbar', 'Header', 'header', 'Nav.', 'nav.',
    'TopBar', 'topbar', 'AppBar', 'appbar', 'SiteHeader', 'Navigation',
  ];
  const navMatches = findFiles(files, navPatterns);
  const navContents = [];
  for (const f of navMatches.slice(0, 2)) {
    const content = safeReadFile(f, 4000);
    if (content) {
      navContents.push({ path: f, content });
      console.log(`  🧭 Found nav/header: ${f}`);
    }
  }
  if (navContents.length) branding.navComponents = navContents;

  // 6. Homepage / landing page (the thing most likely being modified)
  const homePatterns = [
    '+page.svelte', 'page.tsx', 'page.jsx', 'page.js',
    'index.tsx', 'index.jsx', 'index.svelte', 'Home.tsx', 'Home.jsx',
  ];
  // Only grab root-level pages, not nested routes
  const homeMatches = findFiles(files, homePatterns).filter(
    (f) => f.split('/').length <= 3
  );
  for (const f of homeMatches.slice(0, 1)) {
    const content = safeReadFile(f, 6000);
    if (content) {
      branding.homepage = { path: f, content };
      console.log(`  🏠 Found homepage: ${f}`);
    }
  }

  // 7. package.json name field for project identity
  if (fs.existsSync('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
      if (pkg.name) branding.projectName = pkg.name;
      if (pkg.description) branding.projectDescription = pkg.description;
    } catch {}
  }

  const foundItems = Object.keys(branding).length;
  console.log(`  ✅ Extracted ${foundItems} branding context items`);
  return branding;
}

/**
 * Build context for Claude
 */
function buildContext(files) {
  const context = {
    files: files.slice(0, 30),
    structure: {},
  };

  // Detect framework
  if (fs.existsSync('package.json')) {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    context.framework = detectFramework(pkg);
    context.dependencies = Object.keys(pkg.dependencies || {});
  }

  // Extract branding context — the critical missing piece
  context.branding = extractBrandingContext(files);

  return context;
}

function detectFramework(pkg) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  if (deps['next']) return 'Next.js';
  if (deps['react']) return 'React';
  if (deps['vue']) return 'Vue';
  if (deps['svelte']) return 'Svelte';
  if (deps['@angular/core']) return 'Angular';
  if (deps['express']) return 'Express';

  return 'Unknown';
}

/**
 * Format branding context into a readable string for the prompt
 */
function formatBrandingForPrompt(branding) {
  if (!branding || Object.keys(branding).length === 0) return '';

  const sections = [];

  // Project identity
  if (branding.projectName || branding.projectDescription) {
    sections.push(`## Project Identity
- Name: ${branding.projectName || 'Unknown'}
- Description: ${branding.projectDescription || 'Not specified'}`);
  }

  // README
  if (branding.readme) {
    sections.push(`## README.md (Project Documentation)
\`\`\`
${branding.readme}
\`\`\``);
  }

  // Tailwind config
  if (branding.tailwindConfig) {
    sections.push(`## Tailwind Config (Color Palette & Theme)
\`\`\`
${branding.tailwindConfig}
\`\`\``);
  }

  // Global CSS
  if (branding.globalCSS) {
    sections.push(`## Global CSS (Base Styles & Variables)
\`\`\`css
${branding.globalCSS}
\`\`\``);
  }

  // Layouts
  if (branding.layouts && branding.layouts.length) {
    for (const layout of branding.layouts) {
      sections.push(`## Layout File: ${layout.path}
\`\`\`
${layout.content}
\`\`\``);
    }
  }

  // Nav components
  if (branding.navComponents && branding.navComponents.length) {
    for (const nav of branding.navComponents) {
      sections.push(`## Nav/Header Component: ${nav.path}
\`\`\`
${nav.content}
\`\`\``);
    }
  }

  // Homepage
  if (branding.homepage) {
    sections.push(`## Current Homepage: ${branding.homepage.path}
\`\`\`
${branding.homepage.content}
\`\`\``);
  }

  return sections.join('\n\n');
}

/**
 * Call Claude API to generate changes
 */
async function callClaude(prompt, context, isFixMode = false) {
  console.log('\n🤖 Calling Claude API...');

  const brandingText = formatBrandingForPrompt(context.branding);
  const hasBranding = brandingText.length > 0;

  const brandingInstructions = hasBranding
    ? `

═══════════════════════════════════════════════════════
EXISTING PROJECT BRANDING & STYLE CONTEXT
═══════════════════════════════════════════════════════

${brandingText}

═══════════════════════════════════════════════════════
BRANDING PRESERVATION RULES (MANDATORY)
═══════════════════════════════════════════════════════

You MUST follow these rules when generating code:

1. **USE THE PROJECT'S REAL NAME** — Never use placeholder names like "YourBrand", "MyApp", "Acme", or "CompanyName". The project's real name and identity are in the README and package.json above. Use them.

2. **MATCH THE EXISTING COLOR SCHEME** — The tailwind config and CSS files above define the project's exact colors. Use those exact color classes/variables. Do NOT invent new color palettes (no random purple, blue, or other off-brand colors).

3. **PRESERVE THE EXISTING THEME** — If the project uses a dark theme, keep it dark. If it uses light, keep it light. Match the existing background colors, text colors, and accent colors exactly.

4. **REUSE EXISTING COMPONENT PATTERNS** — The layout files, navbar, and homepage above show how the project structures its UI. Follow the same patterns: same CSS classes, same component structure, same spacing conventions.

5. **MATCH THE EXISTING TYPOGRAPHY** — Use the same font families, sizes, and weights defined in the tailwind config and CSS.

6. **DO NOT ADD GENERIC MARKETING COPY** — Don't add placeholder text like "Build Something Amazing" or "Welcome to our platform". If the project has a specific tagline or description in the README, use that.

7. **STAY CONSISTENT WITH EXISTING PAGES** — If other pages in the project use specific UI patterns (cards, buttons, gradients), your changes should use those same patterns.
`
    : '';

  const systemPrompt = isFixMode
    ? `You are Retools AI, an expert debugging and error-fixing assistant.

**Context:**
- Framework: ${context.framework || 'Unknown'}
- Files: ${context.files.length} source files
- Dependencies: ${context.dependencies?.slice(0, 10).join(', ') || 'None'}

**Your task:**
The previous AI changes caused a build failure. Analyze the build error and fix ONLY the issues causing the build to fail.

**Critical Instructions:**
- Focus ONLY on fixing the build errors shown in the prompt
- Make MINIMAL changes - only what's needed to fix the build
- DO NOT add new features or make unrelated changes
- Preserve all existing functionality and BRANDING (colors, names, theme)
- Follow the project's coding style and framework conventions
- If the error is about missing dependencies, add them to package.json
- If the error is about syntax, fix the syntax errors
- If the error is about missing files, create them with minimal content
${brandingInstructions}
Respond with a JSON array of file modifications in this format:
[
  {
    "path": "relative/path/to/file.js",
    "action": "modify" | "create" | "delete",
    "content": "full file content after changes"
  }
]`
    : `You are Retools AI, an expert code modification assistant.

**Context:**
- Framework: ${context.framework || 'Unknown'}
- Files: ${context.files.length} source files
- Dependencies: ${context.dependencies?.slice(0, 10).join(', ') || 'None'}
- File list: ${context.files.join(', ')}
${brandingInstructions}
**Your task:**
Apply the requested changes to the codebase. Be precise and preserve the existing code style, framework conventions, and BRANDING.

**Important:**
- DO NOT translate between frameworks (preserve React as React, Vue as Vue, etc.)
- Make minimal, targeted changes
- Preserve existing file structure
- Follow the project's coding style
- Ensure all changes will build successfully
- PRESERVE the project's branding, colors, theme, and visual identity in ALL generated code

Respond with a JSON array of file modifications in this format:
[
  {
    "path": "relative/path/to/file.js",
    "action": "modify" | "create" | "delete",
    "content": "full file content after changes"
  }
]`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 16000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const content = data.content[0].text;

  console.log('✅ Claude response received');

  // Parse JSON response
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('❌ Failed to parse Claude response:', error);
    console.log('Raw response:', content);
    throw error;
  }
}

/**
 * Apply file modifications
 */
function applyChanges(modifications) {
  console.log(`\n📝 Applying ${modifications.length} file modifications...`);

  for (const mod of modifications) {
    const filePath = path.join(workingDir, mod.path);

    if (mod.action === 'delete') {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`  🗑️  Deleted: ${mod.path}`);
      }
    } else if (mod.action === 'create' || mod.action === 'modify') {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(filePath, mod.content, 'utf-8');
      console.log(`  ${mod.action === 'create' ? '✨' : '✏️ '} ${mod.action}: ${mod.path}`);
    }
  }

  console.log('✅ All changes applied');
}

/**
 * Main execution
 */
async function main() {
  try {
    const files = scanRepository();
    const context = buildContext(files);
    const modifications = await callClaude(prompt, context, fixMode);
    applyChanges(modifications);

    if (fixMode) {
      console.log('\n✅ AI auto-fix completed successfully');
    } else {
      console.log('\n✅ AI driver completed successfully');
    }
    process.exit(0);
  } catch (error) {
    console.error('\n❌ AI driver failed:', error);
    process.exit(1);
  }
}

main();


