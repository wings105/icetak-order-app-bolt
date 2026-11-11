// Scoped compatibility adapter for the immutable acrylic worker below.
// OpenAI requires JSON instructions inside input, not only top-level instructions.
export function prepareResponses(init) {
 if (!init || typeof init.body !== 'string') return init;
 const body = JSON.parse(init.body);
 if (body.text?.format?.type !== 'json_object' || !Array.isArray(body.input)) return init;
 body.input = [{ role: 'developer', content: [{ type: 'input_text', text: 'Return only a valid JSON object matching the schema in the instructions.' }] }, ...body.input];
 return { ...init, body: JSON.stringify(body) };
}
export function installTransport(fetchImpl, target = globalThis) {
 target.fetch = async (input, init) => {
  const responses = String(input) === 'https://api.openai.com/v1/responses';
  const response = await fetchImpl(input, responses ? prepareResponses(init) : init);
  if (responses && !response.ok) {
   const body = await response.clone().json().catch(() => ({}));
   const e = body.error || {};
   // Do not log request payloads or credentials.
   throw new Error(('OPENAI_TEXT_' + response.status + ': ' + String(e.code || '') + ' ' + String(e.param || '') + ' ' + String(e.message || '')).slice(0, 500));
  }
  return response;
 };
}
