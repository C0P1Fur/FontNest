#!/usr/bin/env node
/**
 * 生成字体目录。
 *
 * 为什么要有这个脚本：catalog 里的 sha256 决定"下载到的文件是不是我们要的那个"。
 * 手填哈希等于没有哈希——必须由脚本下载真实文件算出来。
 *
 * 用法：
 *   node scripts/build-catalog.mjs                    # 全量
 *   node scripts/build-catalog.mjs --only=inter,lexend # 只跑指定 id
 *   node scripts/build-catalog.mjs --dry-run          # 只解析，不下载
 *
 * 需要代理时（Node 的 fetch 不读系统代理，也不读 HTTPS_PROXY）：
 *   set FONTNEST_PROXY=http://127.0.0.1:7897
 *   node scripts/build-catalog.mjs
 * 有 curl 就用 curl（它认代理），没有则退回 fetch。
 *
 * 输出：crates/fontnest-core/data/catalog.json
 */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

const HERE = dirname(fileURLToPath(import.meta.url))
const RECIPES = resolve(HERE, 'catalog.source.json')
const OUTPUT = resolve(HERE, '../crates/fontnest-core/data/catalog.json')
const MAX_BYTES = 120 * 1024 * 1024

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const onlyArg = args.find((arg) => arg.startsWith('--only='))
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null
const proxy =
  process.env.FONTNEST_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || ''

/** sfnt 魔数。挡掉"服务器返回了一张 HTML 错误页"这类事故。 */
function looksLikeFont(buffer) {
  if (buffer.length < 4) return false
  const tag = buffer.subarray(0, 4).toString('latin1')
  if (tag === 'OTTO' || tag === 'true' || tag === 'ttcf') return true
  return buffer[0] === 0x00 && buffer[1] === 0x01 && buffer[2] === 0x00 && buffer[3] === 0x00
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 用 curl 下载到临时文件再读。
 * 刻意不走管道：某些受限环境下带 pipe 的 spawn 会直接 EPERM。
 */
async function downloadWithCurl(url, target) {
  const cliArgs = ['-sS', '-L', '--fail', '--max-time', '300', '-A', 'fontnest-catalog-builder', '-o', target]
  if (proxy) cliArgs.push('-x', proxy)
  cliArgs.push(url)
  await run('curl', cliArgs, { maxBuffer: 1024 * 1024 })
  return readFile(target)
}

async function downloadWithFetch(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'fontnest-catalog-builder' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)

  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) throw new Error(`文件过大：${human(declared)}`)
  return Buffer.from(await response.arrayBuffer())
}

let curlAvailable = null
async function hasCurl() {
  if (curlAvailable !== null) return curlAvailable
  try {
    await run('curl', ['--version'], { maxBuffer: 1024 * 1024 })
    curlAvailable = true
  } catch {
    curlAvailable = false
  }
  return curlAvailable
}

async function fetchFont(url, scratch) {
  const buffer = (await hasCurl())
    ? await downloadWithCurl(url, join(scratch, 'download.bin'))
    : await downloadWithFetch(url)

  if (buffer.length > MAX_BYTES) throw new Error(`下载超过上限：${human(buffer.length)}`)

  // 有些字体只发布 zip，里面才是 .ttf。用 tar 解开（Win10+/macOS/Linux 都自带）。
  if (buffer.subarray(0, 2).toString('latin1') === 'PK') {
    throw new ZipArchive(`返回的是 zip 而不是字体文件（${human(buffer.length)}）`)
  }
  if (!looksLikeFont(buffer)) {
    throw new Error(`返回内容不是字体文件（前 4 字节：${buffer.subarray(0, 4).toString('hex')}）`)
  }
  return { sha256: createHash('sha256').update(buffer).digest('hex'), size: buffer.length }
}

class ZipArchive extends Error {}

/** 解开 zip，按文件名找成员。返回成员的字节。 */
async function extractFromZip(zipPath, memberName, scratch) {
  const outDir = join(scratch, 'extract')
  await mkdir(outDir, { recursive: true })
  await run('tar', ['-xf', zipPath, '-C', outDir], { maxBuffer: 1024 * 1024 })

  const found = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name === memberName) found.push(full)
    }
  }
  await walk(outDir)
  if (found.length === 0) {
    throw new Error(`zip 里找不到 ${memberName}`)
  }
  return readFile(found[0])
}

async function main() {
  const recipes = JSON.parse(await readFile(RECIPES, 'utf8'))
  const scratch = await mkdtemp(join(tmpdir(), 'fontnest-catalog-'))
  const fonts = []
  const failures = []

  try {
    for (const recipe of recipes.fonts) {
      if (only && !only.has(recipe.id)) continue

      const variants = []
      for (const variant of recipe.variants ?? []) {
        if (dryRun) {
          console.log(`[dry] ${recipe.id}/${variant.name}  ${variant.url}`)
          continue
        }
        try {
          const hashOf = (bytes) => ({
            sha256: createHash('sha256').update(bytes).digest('hex'),
            size: bytes.length,
          })
          let result
          let member = null
          try {
            result = await fetchFont(variant.url, scratch)
          } catch (error) {
            // 只发 zip 的字体：校验对象是归档本身（传输中的那份字节），
            // 解包交给 Rust 侧做——所以这里记录的是 zip 的哈希和成员名。
            if (!(error instanceof ZipArchive) || !variant.member) throw error
            const archive = await readFile(join(scratch, 'download.bin'))
            const bytes = await extractFromZip(join(scratch, 'download.bin'), variant.member, scratch)
            if (!looksLikeFont(bytes)) throw new Error(`${variant.member} 不是有效字体文件`)
            result = hashOf(archive)
            member = variant.member
          }
          const { sha256, size } = result
          const entry = {
            name: variant.name,
            fileName: variant.file,
            size,
            sources: [{ url: variant.url, mirror: false, sha256 }],
          }
          if (member) entry.member = member
          variants.push(entry)
          console.log(
            `[ok]   ${recipe.id}/${variant.name}  ${human(size)}  sha=${sha256.slice(0, 12)}…` +
              (member ? `  (zip→${member})` : ''),
          )
        } catch (error) {
          failures.push(`${recipe.id}/${variant.name}: ${error.message}`)
          console.error(`[FAIL] ${recipe.id}/${variant.name}  ${error.message}`)
        }
      }

      if (dryRun) {
        fonts.push(recipe)
        continue
      }
      if (variants.length === 0) {
        if ((recipe.variants ?? []).length > 0) {
          console.error(`[skip] ${recipe.id}：全部变体下载失败，未写入目录`)
        }
        continue
      }

      fonts.push({
        id: recipe.id,
        family: recipe.family,
        aliases: recipe.aliases ?? [],
        nameZh: recipe.nameZh ?? '',
        category: recipe.category ?? '',
        scripts: recipe.scripts ?? [],
        coverage: recipe.coverage ?? '',
        license: recipe.license ?? '',
        licenseUrl: recipe.licenseUrl ?? '',
        redistributable: true,
        homepage: recipe.homepage ?? '',
        note: recipe.note ?? '',
        variants,
      })
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }

  if (dryRun) {
    console.log(`\n（dry-run）解析出 ${fonts.length} 条，未写文件`)
    return
  }

  // B 类：只指路的条目。没有文件源，只有官网地址——
  // 它们的许可禁止我们再分发文件，所以 variants 必须为空。
  const linkOnly = (recipes.linkOnly ?? []).map((recipe) => ({
    id: recipe.id,
    family: recipe.family,
    aliases: recipe.aliases ?? [],
    nameZh: recipe.nameZh ?? '',
    category: recipe.category ?? '',
    scripts: recipe.scripts ?? [],
    coverage: recipe.coverage ?? '',
    license: recipe.license ?? '',
    licenseUrl: recipe.licenseUrl ?? '',
    redistributable: false,
    homepage: recipe.homepage ?? '',
    note: recipe.note ?? '',
    variants: [],
  }))
  fonts.push(...linkOnly)

  // 一条都没成功时**不要**覆盖已有目录——否则一次网络故障就会把好数据清空
  if (fonts.length === 0) {
    console.error(`\n没有任何条目成功，保留原有 catalog.json 不动。失败 ${failures.length} 个。`)
    process.exitCode = 1
    return
  }

  const catalog = {
    version: recipes.version ?? 1,
    updatedAt: new Date().toISOString().slice(0, 10),
    fonts: fonts.sort((a, b) => a.id.localeCompare(b.id)),
  }

  // 用 --only 做增量修补时，把没参与本次运行的条目从现有目录里保留下来，
  // 否则一次局部重建会把其余条目全冲掉。
  if (only) {
    try {
      const previous = JSON.parse(await readFile(OUTPUT, 'utf8'))
      const produced = new Set(catalog.fonts.map((font) => font.id))
      const kept = (previous.fonts ?? []).filter((font) => !produced.has(font.id))
      catalog.fonts = [...catalog.fonts, ...kept].sort((a, b) => a.id.localeCompare(b.id))
    } catch {
      // 没有旧文件就正常写
    }
  }

  await mkdir(dirname(OUTPUT), { recursive: true })
  await writeFile(OUTPUT, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')

  console.log(`\n写入 ${fonts.length} 条 → ${OUTPUT}`)
  if (failures.length > 0) {
    console.error(`\n${failures.length} 个变体失败：`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
