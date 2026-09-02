const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'

function parseStoredDate(value: string) {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
  const timestamp = Date.parse(hasTimezone ? normalized : `${normalized}Z`)
  return Number.isNaN(timestamp) ? null : new Date(timestamp)
}

function dateParts(value: string | null | undefined) {
  if (!value) return null
  const date = parseStoredDate(value)
  if (!date) return null
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: SHANGHAI_TIME_ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, hourCycle: 'h23',
    }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  ) as Record<string, string>
}

export function formatDateTime(value: string | null | undefined, fallback = '-') {
  const parts = dateParts(value)
  if (!parts) return fallback
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

export function formatDateTimeInput(value: string | null | undefined) {
  const parts = dateParts(value)
  return parts ? `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` : ''
}

export function shanghaiInputToIso(value: string) {
  const date = new Date(`${value}:00+08:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
