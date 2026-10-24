import { defineCommand } from '../data/workstation.js'
import { sendNativeList } from '../data/interactive.js'
import { formatMessage } from '../data/formatter.js'
import { roleLabel } from '../data/permissions.js'
import { isVip } from '../data/vip.js'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

const PAGES = Object.freeze({
  comecar: {
    title: 'Primeiros passos', icon: '🌸', roles: ['member', 'admin', 'subowner', 'owner'],
    lines: prefix => [
      `1. Use ${prefix}registrar para criar sua conta.`,
      `2. Abra ${prefix}menu para ver todas as categorias.`,
      `3. Use ${prefix}perfil para consultar sua conta.`,
      `4. Use ${prefix}rotina para acessar atividades diárias.`,
      `5. Use ${prefix}tutorial economia para aprender a progredir.`
    ],
    rows: prefix => [
      { id: `${prefix}registrar`, title: '🌸 Criar conta', description: 'Registrar ou confirmar sua conta Sakura' },
      { id: `${prefix}perfil`, title: '🌸 Abrir perfil', description: 'Foto, economia, PVP, VIP e vínculos' },
      { id: `${prefix}menu`, title: '💮 Menu completo', description: 'Todas as categorias e comandos' }
    ]
  },
  economia: {
    title: 'Economia e mineração', icon: '🌸', roles: ['member', 'admin', 'subowner', 'owner'],
    lines: prefix => [
      `Colha ${prefix}diario e abra ${prefix}caixadiaria.`,
      `Trabalhe com ${prefix}trabalhar e acompanhe ${prefix}missao.`,
      `Minere usando ${prefix}minerar e evolua com ${prefix}melhorarpicareta.`,
      `Use ${prefix}investir, ${prefix}loja, ${prefix}pets e ${prefix}casa para avançar.`,
      `Confira ${prefix}saldo e ${prefix}extrato antes de operações grandes.`
    ],
    rows: prefix => [
      { id: `${prefix}rotina`, title: '🌸 Rotina diária', description: 'Diário, trabalho, caixas e missões' },
      { id: `${prefix}minerar`, title: '💮 Minerar', description: 'Ouro, materiais e progressão de picareta' },
      { id: `${prefix}loja`, title: '🌸 Lojas e comércio', description: 'Comprar, anunciar e vender itens' },
      { id: `${prefix}pets`, title: '🌸 Pets', description: 'Coleção, pet ativo e evolução' },
      { id: `${prefix}casa`, title: '🌸 Casas', description: 'Moradia, descanso e bônus moderados' }
    ]
  },
  pvp: {
    title: 'PVP e arena', icon: '🌸', roles: ['member', 'admin', 'subowner', 'owner'],
    lines: prefix => [
      `Desafie alguém com ${prefix}pvp @pessoa.`,
      'O alvo precisa aceitar dentro do prazo.',
      `Consulte atributos e histórico em ${prefix}pvp atributos e ${prefix}pvp historico.`,
      `Veja classificação com ${prefix}rankarena e ${prefix}rankdano.`,
      'Lutas repetidas contra a mesma pessoa perdem recompensa para impedir farm.'
    ],
    rows: prefix => [
      { id: `${prefix}pvp atributos`, title: '🌸 Meus atributos', description: 'Vida, ataque, defesa e agilidade' },
      { id: `${prefix}pvp historico`, title: '🌸 Histórico PVP', description: 'Rodadas, dano e adversários recentes' },
      { id: `${prefix}rankarena`, title: '🌸 Ranking da arena', description: 'Rating competitivo do grupo' }
    ]
  },
  social: {
    title: 'Relacionamentos e família', icon: '🌸', roles: ['member', 'admin', 'subowner', 'owner'],
    lines: prefix => [
      `Use ${prefix}namorar @pessoa para enviar um pedido.`,
      `Casamento exige namoro atual: ${prefix}casar @pessoa.`,
      `Adoções também exigem aceite: ${prefix}adotar @pessoa.`,
      `Consulte seus vínculos com ${prefix}relacionamento e ${prefix}familia.`,
      'Nenhum vínculo é criado sem consentimento do alvo.'
    ],
    rows: prefix => [
      { id: `${prefix}relacionamento`, title: '🌸 Relacionamento', description: 'Status e duração do vínculo atual' },
      { id: `${prefix}familia`, title: '🌸 Família', description: 'Árvore familiar e adoções' },
      { id: `${prefix}pedidossociais`, title: '🌸 Pedidos pendentes', description: 'Aceitar ou recusar solicitações' },
      { id: `${prefix}acoes`, title: '🌸 Ações sociais', description: 'Abraços, beijos, cafuné e presentes' }
    ]
  },
  figurinhas: {
    title: 'Figurinhas', icon: '💮', roles: ['member', 'admin', 'subowner', 'owner'],
    lines: (prefix, vip) => [
      `Responda uma foto ou vídeo com ${prefix}s.`,
      `Envie fotos recentes e use ${prefix}s20 para criar um lote.`,
      `Troque créditos com ${prefix}take Pacote | Autor.`,
      vip ? `VIP ativo: você pode usar ${prefix}fig60 e transformações avançadas.` : `Recursos avançados exigem VIP; consulte ${prefix}vipstatus.`,
      `Use ${prefix}brat texto para uma figurinha de texto.`
    ],
    rows: (prefix, vip) => [
      { id: `${prefix}s`, title: '💮 Criar figurinha', description: 'Foto, vídeo ou GIF respondido' },
      { id: `${prefix}s20`, title: '🌸 Lote recente', description: 'Até 20 imagens em fila controlada' },
      { id: `${prefix}take`, title: '🌸 Alterar créditos', description: 'Pacote, autor e metadados' },
      ...(vip ? [{ id: `${prefix}fig60`, title: '🌸 Figurinha VIP', description: 'Animação experimental com fallback' }] : []),
      { id: `${prefix}brat exemplo`, title: '💮 Brat', description: 'Figurinha de texto compatível com ARM' }
    ]
  },
  ia: {
    title: 'Inteligência artificial', icon: '💮', roles: ['member', 'admin', 'subowner', 'owner'],
    lines: (prefix, vip, role) => [
      `Consulte o estado com ${prefix}ia status.`,
      'A Sakura respeita contexto limitado, cooldown e limite diário.',
      role === 'member' ? 'Somente administradores podem ativar a IA do grupo.' : `Ative naturalmente com ${prefix}autoia on.`,
      role === 'owner' ? `Gerencie tokens criptografados com ${prefix}groqtoken.` : 'Tokens reais nunca são exibidos a membros ou administradores.',
      `Limpe seu contexto com ${prefix}ia limpar.`
    ],
    rows: (prefix, vip, role) => [
      { id: `${prefix}ia status`, title: '💮 Status da IA', description: 'Modelo, limites e disponibilidade' },
      ...(role !== 'member' ? [{ id: `${prefix}autoia on`, title: '💮 Ativar Auto IA', description: 'Responde ao nome Sakura em qualquer parte da frase' }] : []),
      { id: `${prefix}ia limpar`, title: '🌸 Limpar contexto', description: 'Apaga o histórico recente desta conversa' }
    ]
  },
  downloads: {
    title: 'Downloads e mídia', icon: '🌸', roles: ['member', 'admin', 'subowner', 'owner'],
    lines: prefix => [
      `Envie ${prefix}play nome da música para buscar áudio.`,
      `Use ${prefix}tiktok com um link público para baixar vídeos.`,
      `Instagram e Pinterest podem ser usados pelos comandos de download social.`,
      `Administradores podem ativar downloads automáticos com ${prefix}autodl on.`,
      'Arquivos grandes entram em fila para não travar outras conversas.'
    ],
    rows: prefix => [
      { id: `${prefix}play`, title: '💮 Player', description: 'Pesquisar e baixar áudio com fila' },
      { id: `${prefix}tiktok`, title: '💮 TikTok', description: 'Baixar vídeo público pelo link' },
      { id: `${prefix}autodl status`, title: '🌸 Download automático', description: 'Status no grupo atual' }
    ]
  },
  casais: {
    title: 'Casais e brincadeiras', icon: '🌸', roles: ['member', 'admin', 'subowner', 'owner'],
    lines: prefix => [
      `Use ${prefix}ship @pessoa1 @pessoa2 para medir compatibilidade.`,
      `${prefix}casal sorteia duas pessoas reais do grupo e descreve a relação.`,
      `Use ${prefix}brincadeiras para ver mais de 100 testes de porcentagem.`,
      `Mídias personalizadas podem variar por resultado sem alterar os dados dos usuários.`,
      'Esses comandos são brincadeiras e não definem características reais.'
    ],
    rows: prefix => [
      { id: `${prefix}ship`, title: '🌸 Ship', description: 'Compatibilidade entre duas pessoas' },
      { id: `${prefix}casal`, title: '🌸 Casal aleatório', description: 'Sorteio e tipo de relacionamento' },
      { id: `${prefix}brincadeiras`, title: '💮 Todos os testes', description: 'Catálogo completo de porcentagens' }
    ]
  },
  midias: {
    title: 'Mídias personalizadas', icon: '🌸', roles: ['admin', 'subowner', 'owner'],
    lines: (prefix, vip, role) => [
      `Responda uma mídia com ${prefix}setmidia ship ou use uma URL HTTPS segura.`,
      `Use ${prefix}addmidia para cadastrar variações e ${prefix}listarmidias para revisar.`,
      `Faixas como 0-20 e categorias como raro escolhem mídias conforme o resultado.`,
      role === 'owner' ? `Mídias globais são padrão; use --grupo para limitar ao grupo atual.` : 'Administradores autorizados alteram somente as mídias do próprio grupo.',
      role === 'owner' ? `Libere admins com ${prefix}permitirmidiagp on dentro do grupo.` : 'A permissão precisa ser ativada pelo dono principal.'
    ],
    rows: (prefix, vip, role) => [
      { id: `${prefix}listarmidias ship --grupo`, title: '🌸 Listar mídias', description: 'Revisar itens do grupo atual' },
      { id: `${prefix}testarmidia ship --grupo`, title: '🌸 Testar mídia', description: 'Simular a resposta sem alterar dados' },
      ...(role === 'owner' ? [{ id: `${prefix}permitirmidiagp status`, title: '🌸 Permissão dos admins', description: 'Autorizar edição somente neste grupo' }] : [])
    ]
  },
  dicas: {
    title: 'Dicas úteis', icon: '🌸', roles: ['member', 'admin', 'subowner', 'owner'],
    lines: prefix => [
      `Use ${prefix}menu buscar palavra quando não lembrar um comando.`,
      `Abra ${prefix}extrato antes de confirmar transferências importantes.`,
      `Responda à mídia original ao usar ${prefix}s, ${prefix}take ou configurações de mídia.`,
      `Diga “Sakura” em uma frase quando ${prefix}autoia estiver ligada.`,
      'Evite repetir comandos rapidamente; filas e cooldowns protegem o número e o grupo.'
    ],
    rows: prefix => [
      { id: `${prefix}menu buscar figurinha`, title: '💮 Pesquisar', description: 'Encontrar comandos por palavra' },
      { id: `${prefix}autoia status`, title: '💮 Auto IA', description: 'Ver ativação e cooldown do grupo' },
      { id: `${prefix}ping`, title: '🌸 Ver velocidade', description: 'Latência e estado da Sakura' }
    ]
  },
  grupo: {
    title: 'Configurações do grupo', icon: '🌸', roles: ['admin', 'subowner', 'owner'],
    lines: prefix => [
      `Abra ${prefix}admin para ferramentas de moderação.`,
      `Use ${prefix}automacoes para boas-vindas, downloads, rotina e antiflood.`,
      `Pause automações à noite com ${prefix}horariosilencioso 22:00 07:00.`,
      `Configure a IA local com ${prefix}ia grupo on ou off.`,
      `Use ${prefix}boasvindas mensagem <texto> para personalizar a entrada.`,
      'A Sakura precisa ser administradora apenas nos comandos que realmente alteram o grupo.'
    ],
    rows: prefix => [
      { id: `${prefix}admin`, title: '🌸 Administração', description: 'Ferramentas e permissões do grupo' },
      { id: `${prefix}automacoes`, title: '💮 Automações', description: 'Boas-vindas, downloads, rotina e antiflood' },
      { id: `${prefix}horariosilencioso status`, title: '💮 Horário silencioso', description: 'Pausa automações em horários definidos' },
      { id: `${prefix}ia status`, title: '💮 IA do grupo', description: 'Estado e limites desta conversa' }
    ]
  },
  dono: {
    title: 'Dono e subdono', icon: '💮', roles: ['subowner', 'owner'],
    lines: (prefix, vip, role) => [
      `Gerencie contratos com ${prefix}contrato.`,
      `Gerencie VIP com ${prefix}vip.`,
      `Consulte módulos usando ${prefix}statusmodulos.`,
      role === 'owner' ? `Adicione ou remova subdonos em ${prefix}subdonos.` : 'Subdonos não podem promover donos nem acessar sessões ou segredos.',
      role === 'owner' ? `O pool Groq fica em ${prefix}groqtoken e exige chave no ambiente.` : 'Tokens completos permanecem inacessíveis ao subdono.',
      role === 'owner' ? `Controle o privado com ${prefix}antipv e ${prefix}antichamada.` : 'Proteções do número ficam sob controle do dono principal.',
      role === 'owner' ? `Consulte envios automáticos com ${prefix}filaenvios status.` : 'A fila global não pode ser alterada por subdonos.'
    ],
    rows: (prefix, vip, role) => [
      { id: `${prefix}contrato`, title: '💮 Contratos', description: 'Duração, renovação e expiração' },
      { id: `${prefix}vip`, title: '🌸 VIP', description: 'Benefícios e duração personalizada' },
      { id: `${prefix}statusmodulos`, title: '🌸 Status dos módulos', description: 'Recursos ativos sem revelar segredos' },
      ...(role === 'owner' ? [
        { id: `${prefix}subdonos`, title: '💮 Subdonos', description: 'Hierarquia e permissões persistentes' },
        { id: `${prefix}antipv status`, title: '🌸 Proteção privada', description: 'Avisos, chamadas, permissões e bloqueios' },
        { id: `${prefix}filaenvios status`, title: '🌸 Fila de envios', description: 'Pausar, retomar ou cancelar pendências' }
      ] : [])
    ]
  }
})

function availablePages(role) {
  return Object.entries(PAGES).filter(([, page]) => page.roles.includes(role))
}

function pageSections(prefix, key, page, vip, role) {
  const rows = page.rows(prefix, vip, role)
  return [{ title: `${page.icon} Acessos rápidos`, rows }, {
    title: '💮 Navegação',
    rows: [
      { id: `${prefix}tutorial`, title: '🌸 Índice do tutorial', description: 'Voltar a todas as categorias permitidas' },
      { id: `${prefix}menu`, title: '💮 Menu principal', description: 'Abrir o catálogo completo da Sakura' },
      { id: `${prefix}calc 200 * 10%`, title: '💮 Testar calculadora', description: 'Exemplo seguro de porcentagem' }
    ]
  }]
}


function tutorialIndexSections(entries, prefix, vip, role) {
  const rows = entries.map(([key, page]) => ({
    id: `${prefix}tutorial ${key}`,
    title: `${page.icon} ${page.title}`,
    description: page.lines(prefix, vip, role)[0].slice(0, 90)
  }))
  const sections = []
  for (let index = 0; index < rows.length; index += 10) {
    sections.push({ title: index ? '🌸 Mais páginas' : '🌸 Páginas disponíveis', rows: rows.slice(index, index + 10) })
  }
  sections.push({
    title: '💮 Ajuda rápida',
    rows: [
      { id: `${prefix}menu`, title: '💮 Menu completo', description: 'Categorias, catálogo e pesquisa' },
      { id: `${prefix}menu buscar perfil`, title: '💮 Pesquisar comandos', description: 'Encontrar uma função pelo nome' },
      { id: `${prefix}calculadora`, title: '💮 Calculadora', description: 'Operações matemáticas seguras' }
    ]
  })
  return sections
}

export default defineCommand({
  name: 'tutorial',
  aliases: ['tuto', 'guia', 'comecar', 'primeirospassos'],
  menuEntries: [
    { name: 'tutorial', usage: '.tutorial', description: 'Tutorial adaptado ao cargo, VIP e recursos disponíveis.', menuGroup: 'Ajuda' },
    { name: 'guia', usage: '.guia economia', description: 'Abre diretamente uma página do tutorial.', menuGroup: 'Ajuda' }
  ],
  category: 'Principal',
  usage: '.tutorial [categoria]',
  description: 'Explica os sistemas da Sakura em páginas curtas e mostra apenas recursos relevantes ao usuário.',
  needsMetadata: true,
  async execute({ sock, msg, args, settings, logger, role = 'member', senderNumber }) {
    const vip = await isVip(senderNumber)
    const requested = normalize(args[0])
    const entries = availablePages(role)
    const matched = entries.find(([key, page]) => key === requested || normalize(page.title) === requested)

    if (matched) {
      const [key, page] = matched
      const lines = page.lines(settings.prefix, vip, role)
      return sendNativeList({
        sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: `tutorial:${key}`,
        body: formatMessage([
          `${page.icon} *${page.title}*`,
          `perfil de acesso: ${roleLabel(role)}${vip ? ' • VIP' : ''}`,
          ...lines
        ].join('\n'), { title: 'TUTORIAL SAKURA', icon: page.icon }),
        buttonText: 'Abrir atalhos',
        sections: pageSections(settings.prefix, key, page, vip, role)
      })
    }

    return sendNativeList({
      sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'tutorial:index',
      body: formatMessage([
        '🌸 *Guia interativo da Sakura*',
        `acesso detectado: ${roleLabel(role)}${vip ? ' • VIP ativo' : ''}`,
        'Escolha uma parte. O guia mostra somente funções compatíveis com suas permissões.',
        `Para procurar qualquer comando, use ${settings.prefix}menu buscar palavra.`
      ].join('\n'), { title: 'TUTORIAL', icon: '🌸' }),
      buttonText: 'Escolher assunto',
      sections: tutorialIndexSections(entries, settings.prefix, vip, role)
    })
  }
})
