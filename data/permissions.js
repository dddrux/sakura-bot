const LEVELS = Object.freeze({ member: 0, admin: 1, subowner: 2, owner: 3 })

export const PERMISSIONS = Object.freeze({
  PUBLIC: 'public.use',
  GROUP_ADMIN: 'group.admin',
  CONTRACTS: 'contracts.manage',
  VIP: 'vip.manage',
  GLOBAL_CONFIG: 'global.configure',
  SUBOWNERS: 'subowners.manage',
  AUDIT: 'audit.view',
  SECRETS: 'secrets.manage'
})

export const PERMISSION_MATRIX = Object.freeze({
  [PERMISSIONS.PUBLIC]: 'member',
  [PERMISSIONS.GROUP_ADMIN]: 'admin',
  [PERMISSIONS.CONTRACTS]: 'subowner',
  [PERMISSIONS.VIP]: 'subowner',
  [PERMISSIONS.GLOBAL_CONFIG]: 'subowner',
  [PERMISSIONS.SUBOWNERS]: 'owner',
  [PERMISSIONS.AUDIT]: 'owner',
  [PERMISSIONS.SECRETS]: 'owner'
})

export function normalizeRole(role = 'member') {
  const key = String(role || '').toLowerCase()
  return Object.hasOwn(LEVELS, key) ? key : 'member'
}

export function roleLevel(role = 'member') {
  return LEVELS[normalizeRole(role)]
}

export function roleLabel(role = 'member') {
  return ({ member: 'Membro', admin: 'Administrador', subowner: 'Subdono', owner: 'Dono' })[normalizeRole(role)]
}

export function hasPermission(role, permission) {
  const required = PERMISSION_MATRIX[permission] || 'owner'
  return roleLevel(role) >= roleLevel(required)
}

export function visibleCommandForRole(command, role = 'member') {
  const normalized = normalizeRole(role)
  if (command?.ownerOnly && normalized !== 'owner' && !(command?.subownerAllowed && normalized === 'subowner')) return false
  if (command?.adminOnly && roleLevel(normalized) < roleLevel('admin')) return false
  return true
}
