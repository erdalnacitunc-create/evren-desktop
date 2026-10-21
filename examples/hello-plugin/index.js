module.exports = {
  register(api) {
    api.registerTool({
      name: 'word_count',
      description: 'Metindeki kelime sayısını döndürür.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Sayılacak metin.' }
        },
        required: ['text']
      },
      async execute({ text }) {
        const count = String(text)
          .trim()
          .split(/\s+/)
          .filter(Boolean).length
        api.log('word_count çağrıldı:', count)
        return `${count} kelime`
      }
    })
  }
}
