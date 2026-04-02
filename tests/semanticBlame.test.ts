import { describe, it, expect } from 'vitest'
import { extractBlockLabel } from '../src/core/search/semanticBlame.js'

describe('extractBlockLabel', () => {
  it('extracts TypeScript function name', () => {
    expect(extractBlockLabel('function validateToken(token: string) {\n  return true\n}')).toBe('function validateToken')
  })

  it('extracts exported TypeScript function name', () => {
    expect(extractBlockLabel('export async function fetchUser(id: string) {\n  return null\n}')).toBe('function fetchUser')
  })

  it('extracts TypeScript class name', () => {
    expect(extractBlockLabel('export class AuthService {\n  constructor() {}\n}')).toBe('class AuthService')
  })

  it('extracts arrow function const name', () => {
    expect(extractBlockLabel('const handleRequest = async (req, res) => {\n  res.send("ok")\n}')).toBe('const handleRequest')
  })

  it('extracts Python def name', () => {
    expect(extractBlockLabel('def greet(name):\n    return f"Hello {name}"')).toBe('def greet')
  })

  it('extracts Python async def name', () => {
    expect(extractBlockLabel('async def fetch_data(url):\n    pass')).toBe('def fetch_data')
  })

  it('extracts Python class name', () => {
    expect(extractBlockLabel('class UserModel:\n    pass')).toBe('class UserModel')
  })

  it('returns decorator line as label for a decorator-first block', () => {
    const label = extractBlockLabel('@app.route("/api")\ndef my_view():\n    pass')
    expect(label).toBe('@app.route("/api")')
  })

  it('extracts Go function name', () => {
    expect(extractBlockLabel('func Add(a, b int) int {\n    return a + b\n}')).toBe('func Add')
  })

  it('extracts Go method name (with receiver)', () => {
    expect(extractBlockLabel('func (r *Rect) Area() float64 {\n    return r.Width * r.Height\n}')).toBe('func Area')
  })

  it('extracts Rust fn name', () => {
    expect(extractBlockLabel('fn compute_hash(input: &str) -> String {\n    String::new()\n}')).toBe('fn compute_hash')
  })

  it('extracts Rust pub fn name', () => {
    expect(extractBlockLabel('pub async fn handle(req: Request) -> Response {\n    todo!()\n}')).toBe('fn handle')
  })

  it('extracts Rust impl block label', () => {
    const label = extractBlockLabel('impl<T: Clone> MyType<T> {\n    fn new() -> Self { todo!() }\n}')
    expect(label).toContain('impl')
  })

  it('extracts Java public method name', () => {
    expect(extractBlockLabel('public void processRequest(HttpRequest request) {\n    return;\n}')).toBe('processRequest()')
  })

  it('falls back to first 60 chars for unknown patterns', () => {
    const first = 'x = 1 + 2 + some_long_computation_here_that_fills_the_line()'
    const label = extractBlockLabel(first + '\ny = 3')
    expect(label).toBe(first.slice(0, 60))
  })

  it('handles empty content gracefully', () => {
    const label = extractBlockLabel('')
    expect(typeof label).toBe('string')
    expect(label.length).toBe(0)
  })
})
