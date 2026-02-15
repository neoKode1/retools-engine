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

if (promptIndex === -1 || workingDirIndex === -1) {
  console.error('Usage: ai-driver.js --prompt "..." --working-dir /path/to/repo');
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
 * Build context for Claude
 */
function buildContext(files) {
  const context = {
    files: files.slice(0, 20), // Limit files in context
    structure: {},
  };

  // Detect framework
  if (fs.existsSync('package.json')) {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    context.framework = detectFramework(pkg);
    context.dependencies = Object.keys(pkg.dependencies || {});
  }

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
 * Call Claude API to generate changes
 */
async function callClaude(prompt, context) {
  console.log('\n🤖 Calling Claude API...');

  const systemPrompt = `You are Retools AI, an expert code modification assistant.

**Context:**
- Framework: ${context.framework || 'Unknown'}
- Files: ${context.files.length} source files
- Dependencies: ${context.dependencies?.slice(0, 10).join(', ') || 'None'}

**Your task:**
Apply the requested changes to the codebase. Be precise and preserve the existing code style and framework conventions.

**Important:**
- DO NOT translate between frameworks (preserve React as React, Vue as Vue, etc.)
- Make minimal, targeted changes
- Preserve existing file structure
- Follow the project's coding style

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
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
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
    const modifications = await callClaude(prompt, context);
    applyChanges(modifications);

    console.log('\n✅ AI driver completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ AI driver failed:', error);
    process.exit(1);
  }
}

main();


