# OEM Enterprise · Suite open source de trabajo empresarial + red de negocios

<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ja.md">日本語</a> · <a href="README.ar.md">العربية</a> · <a href="README.fr.md">Français</a> · <strong>Español</strong> · <a href="README.ru.md">Русский</a>
</p>

**Demo en línea: <https://enterprise.aiworkin.com>**

Un proyecto open source que fusiona y traslada a un mismo código un **workbench de trabajo empresarial** (Hono + Prisma + MySQL + Next.js / Ant Design)
y una **red social de negocios (SNS)** (relaciones / publicaciones / grupos / mensajes directos / currículos / plaza de oferta y demanda / reclutamiento).

No es una herramienta puntual, sino una base completa de «gestión interna de la empresa + captación externa + intermediación de negocio»: sobre el sistema de cuentas e identidades,
primero recibe a los visitantes la **página de inicio del sitio** (`/`, landing para usuarios sin sesión, arriba solo inicio de sesión / registro) y desde ahí se entra al cockpit y a los 21 accesos del workbench (Mis tareas, Agent, Flujos de trabajo, Base de conocimiento, Workbuddy Cloud empresarial, Tablas multidimensionales, RPA, Creación de contenido, Herramientas de marketing,
Activos digitales, Correo IA, CRM, BI, OA, OKR, Atención al cliente IA, Workbench de RR. HH., Gestión de proyectos, Compras-ventas-inventario, Centro de aplicaciones, Sala de temas),
las 11 líneas de servicios de negocio (marketing / suministro y distribución / fiscal y contable / internacionalización / empleo flexible / logística / TI / propiedad intelectual / legal / consultoría estratégica / intercambio de activos), la red social de negocios y el reclutamiento,
y un panel de administración de plataforma organizado en 5 grandes categorías con 26 secciones en total (la visión general de datos de la plataforma se integra en el cockpit `/dashboard`). Toda la capacidad social y de oferta/demanda funciona **en circuito cerrado local y sin necesidad de clave**;
cuante publiques demandas / servicios al mercado upstream (AIworkin), prepares el perfil de la empresa o solicites cualificaciones, basta con vincular una AIPDD APIKey para conectarlo todo
—**este sistema no maneja criptomonedas, no custodia cuentas upstream y todos los estilos e interacciones están reescritos en local**.

> Las especificaciones de diseño y de migración están en [`docs/开源版整体设计方案.md`](docs/开源版整体设计方案.md).

| Especificación | Cantidad |
|---|---|
| Rutas de página (Next.js App Router) | 75 |
| Operaciones HTTP (según la instantánea OpenAPI) | 1947 |
| Modelos de datos Prisma | 528 |
| Módulos de negocio del backend | 91 |
| Idiomas de interfaz | 8 (incluye RTL completo en árabe) |
| Base de datos | MySQL 8 o PostgreSQL (se elige una en la instalación) |

> Versión actual **v1.4.0** ([Notas de la versión](https://github.com/liujh0729-jpg/AI-enterprise-OEM/releases/tag/v1.4.0)): cuenta e inicio de sesión mejorados (código de verificación por correo / móvil, escaneo de WeChat, recordar sesión 30 días), los materiales compartidos se amplían al personal de los proveedores de servicios e incorpora módulos como el workbench de base de conocimiento, la plaza de modelos, el workbench de SEO, la captación de clientes con IA, el SCRM de WeCom y el hardware inteligente.

---

## 📸 Vista previa de la interfaz

> Las siguientes capturas provienen del sitio de demostración <https://enterprise.aiworkin.com> (vista del superadministrador; a la izquierda, el menú «Workbench / Servicios de negocio»).

**Workbench de Agent**: la conversación produce imágenes / vídeos al instante; las pestañas cubren conversación, tareas programadas, asistentes, avatares digitales, habilidades, expertos y conectores MCP (el umbral de autorización «Acciones ejecutables automáticamente» cuelga de la pestaña de conectores MCP).
<img src="docs/screenshots/agent.png" width="900" alt="Workbench de Agent">

**Herramientas de marketing**: en una sola pantalla se presentan las herramientas de captación, contacto y datos; cada tarjeta lleva su propia descripción y su acceso independiente (Captación de clientes con IA: radar de prospectos → contacto → ficha de cliente → guion de ventas → seguimiento → control de calidad y panel; la recolección y el contacto los ejecuta el plugin AIPDD Enterprise; SCRM de WeCom: sincronización nativa de clientes, envíos masivos con confirmación humana, SOP, barra lateral para empleados, palabras sensibles y control de calidad con IA; Conexión con creadores, llamadas salientes y envío de correo de Alibaba Cloud, optimización GEO, optimización SEO, captación con códigos vivos, Tencent Qidian, minería de prospectos, macrodatos globales, distribución de contenido multiplataforma, diseño de encuestas e investigación, SalesBuddy).
<img src="docs/screenshots/marketing-tools.png" width="900" alt="Herramientas de marketing">

**Creación de contenido**: texto a imagen, imagen a vídeo, replicación de vídeos, personas digitales, retoque fotográfico y eliminación de marcas de agua, extracción de guiones, síntesis de voz, música, doblaje, remix, inversión de guiones y textos locutados; además dos paquetes de imágenes de «optimización de fichas de producto» para comercio electrónico transfronterizo y nacional; la «comunidad de plantillas de vídeo» permite explorar muestras por uso / novedad / más guardadas y replicarlas con el prompt y las imágenes de referencia usando tu propio modelo, y como la replicación es una tarea asíncrona el progreso y el resultado se siguen en la pestaña «Tareas de generación» de la página (ver una receta de pago otorga puntos al autor; el panel de la plataforma puede completar opcionalmente con plantillas de la plataforma AIworkin); al final se incluyen las herramientas de creación de vídeo desplegables en local.
<img src="docs/screenshots/content-creation.png" width="900" alt="Creación de contenido">

**Servicios fiscales y contables**: material de declaración, plan de declaraciones, gestión de libros, capacidades automatizadas e información de demandas; el plan de declaraciones se genera automáticamente según la condición de contribuyente y la frecuencia de declaración de las empresas contratadas, con progreso impuesto por impuesto y acceso a cada orden de declaración.
<img src="docs/screenshots/tax-service.png" width="900" alt="Servicios fiscales y contables">

**Atención al cliente IA**: conversaciones, equipo de atención, configuración de recepción, frases frecuentes y conocimiento, sitios e integración, canales y estadísticas en una sola pantalla; el estado de recepción se divide en en línea / ausente / desconectado y solo el estado en línea participa en la asignación automática.
<img src="docs/screenshots/ai-service-desk.png" width="900" alt="Atención al cliente IA">

---

## 🗺️ Mapa funcional

| Grupo | Módulo | En una frase | Credencial upstream |
|---|---|---|---|
| Inicio | Página de inicio del sitio (`/`) | Landing estática para visitantes sin sesión: pantalla principal, carrusel de escenarios, secciones de negocio, integraciones abiertas, pasos de uso y FAQ; arriba solo «Iniciar sesión / Registrarse», y el pie lee el nombre, el logotipo, el ICP y los enlaces configurados en el sitio; los textos y las imágenes se mantienen en el panel «Configuración del sistema → Configuración de la página de inicio» | No |
| Inicio | Cockpit directivo (`/dashboard`) | Identidad y cualificaciones, mis pendientes y libro de negocio; la cabecera incluye los accesos rápidos «Gestionar API Key / Recargar puntos» y, si no hay clave AIPDD vinculada, un acceso rojo de vinculación; el cockpit del administrador de plataforma muestra además la visión general de datos de la plataforma, las revisiones pendientes y la distribución de tipos de servicio de los proveedores | No |
| Workbench | Agent | La conversación produce directamente imágenes / vídeos y los resultados van a los activos digitales AIPDD de esta cuenta | AIPDD |
| Workbench | Base de conocimiento (`/kb`) | El material entra al espacio de conocimiento y se compila en páginas wiki trazables, los `[[enlaces]]` hacen crecer el grafo de conocimiento, con búsqueda híbrida y respuestas con citas; la página de memoria alberga la memoria a largo plazo y la memoria operativa | No |
| Workbench | Workbuddy Cloud empresarial | Tareas planificadas (aclaración con IA del encargo), Agent y custodia de cuentas de la nube empresarial y de cuentas de llamada a IA | Tencent Cloud |
| Workbench | Tablas multidimensionales | Tablas de datos estructuradas propias, 8 tipos de columna, creación de tablas con una frase, columnas / consultas / vistas con IA, canal máquina con API Key y sincronización con Feishu | No |
| Workbench | Automatización RPA | Tareas / cuentas / scripts RPA en la nube; el navegador Bit local los recluta, los ejecuta y devuelve el resultado; la extensión local de Chrome se convierte en un **agente de navegador** — describe el resultado en el panel lateral y el Agent actúa de forma autónoma, en varios pasos, en los sitios donde ya has iniciado sesión, y puedes crear tareas programadas que se ejecutan automáticamente según la frecuencia definida | AIPDD / extensión local |
| Workbench | Creación de contenido | Texto a imagen / vídeo, personas digitales, doblaje y música, remix, eliminación de marcas de agua y superresolución, paquetes de optimización de fichas de producto, comunidad de plantillas de vídeo, Drama Agent | AIPDD |
| Workbench | Herramientas de marketing | Captación con IA, SCRM de WeCom, conexión con creadores, llamadas salientes / envío de correo de Alibaba Cloud, optimización GEO, optimización SEO, captación con códigos vivos, Qidian, minería de prospectos, macrodatos globales, distribución de contenido multiplataforma, diseño de encuestas e investigación, biblioteca de habilidades de marketing, SalesBuddy | Autogestión de cada proveedor / plugin local |
| Workbench | Gestión de activos digitales | Los bytes se guardan en el OSS de este sitio: búsqueda, etiquetado, subida y borrado; «Materiales compartidos» comparte por cuenta dentro de la misma organización (empresa certificada o proveedor de servicios) y el archivo sigue siendo del autor; los activos históricos custodiados en AIPDD pueden migrarse por lotes desde el panel | No |
| Workbench | Servicio de correo IA | Lectura POP3 / IMAP de varias cuentas de correo, sin persistir cuerpos ni adjuntos; redacción o respuesta automática según guiones | Código de autorización del correo |
| Workbench | CRM | Prospectos, clientes, oportunidades, contratos de venta, cobros, pedidos, aprobaciones e informes | No |
| Workbench | BI inteligente | Conjuntos de datos curados integrados + fuentes de datos externas de solo lectura, consultas inteligentes, gráficos y paneles | No |
| Workbench | OA | Formularios de vacaciones / gastos / pagos / compras / uso de sello con aprobaciones multinivel y devolución del resultado al negocio | No |
| Workbench | Planificación OKR | Ciclos, árbol de objetivos de la empresa hasta la persona, informes semanales y diarios, evaluación de retrospectivas | No |
| Workbench | Workbench de RR. HH. | Expedientes, asistencia y vacaciones, reclutamiento, nóminas y panel de talento (los «empleados / representantes» de la organización son las mismas personas) | No |
| Workbench | Gestión de proyectos | Proyectos / miembros / hitos / iteraciones, tareas y dependencias, horas registradas y aprobación de partes semanales, tarifas y libros de costos, colaboración externa y catálogo de entidades, WBS con IA y estado de salud | No |
| Workbench | Compras-ventas-inventario | Productos y variantes, stock y movimientos por almacén, compras y entradas, cuentas por cobrar y por pagar y gastos, impuestos y políticas de precio, insights de gestión con IA | No |
| Workbench | Atención al cliente IA | Una cuenta puede colgar varios sitios oficiales, recepción humana + tres modos de respuesta de la IA | No |
| Workbench | Centro de aplicaciones | Aplicaciones integradas + mercado de aplicaciones, con cuatro pestañas y búsqueda por palabra clave | No |
| Workbench | Sala de temas | Debates temáticos internos de la empresa o públicos; quien los inicia puede cerrarlos y pedir un resumen a la IA | No |
| Servicios de negocio | Marketing / suministro y distribución / fiscal y contable / internacionalización / empleo flexible / logística / TI / propiedad intelectual / legal / consultoría estratégica / intercambio de activos | Biblioteca de recursos de proveedores → detalle → contratación; canal de mensajes de demandas y libro de negocio | Parcial |
| Contactos de negocio | Red social de negocios | Amigos / bloqueo, publicaciones, grupos al estilo de Douban, mensajes directos, currículo profesional | No |
| Contactos de negocio | Reclutamiento | Plaza de reclutamiento (publicación de vacantes y contacto por mensaje directo) + envío de currículos con IA (perfil, coincidencia, optimización, confirmación de envío y embudo) | Local: no / sincronización: sí |
| Contactos de negocio | Plaza de oferta y demanda | Publicación genérica de demandas / servicios, en dos fases: local sin clave + sincronización opcional upstream | Local: no / sincronización: sí |
| Servicios de modelo | Plaza de modelos (`/model-plaza`) | Modelos disponibles publicados de forma unificada por la plataforma: unidades de facturación idénticas a upstream, prueba en línea y libro de consumo, con gateway compatible con OpenAI mediante la clave `ek_` | No |
| Servicios de modelo | API Key / API-MCP-Skill / Configuración de modelos / Plataforma de cómputo AIPDD | La clave ek_ llama a `/api/v1`, acceso MCP y selección de modelos; al final, un enlace externo directo a la plataforma de cómputo AIPDD | Parcial |
| Ajustes de gestión | Identidad y cualificaciones / Empleados·representantes / Gestión de contratos / Mis paquetes / Centro de puntos / Mis invitaciones / Mecanismos de plataforma | Verificación, equipo, libro de contratos, puntos de doble moneda, relaciones de invitación y además Webhook, importación y exportación, reglas, compartidos, OIDC, sincronización con Feishu / WeCom, registro de aceptación de términos, analítica de uso y cambio de entidad | Parcial |
| Hardware inteligente | Plaza de hardware / Añadir hardware / MCP de hardware / API de hardware | Catálogo de modelos y kits de desarrollo (descarga de SDK / firmware, verificación SHA-256); dispositivos conectados y estado en línea por heartbeat; herramientas MCP exclusivas por modelo (control por Agent, `hw__modelo__herramienta`) y API (`/api/v1/hardware/**`); SDK / ejemplos / simulador en `hardware-devkit/` del repositorio | No |
| Panel de plataforma | 26 secciones / 5 grupos (ver más abajo) | Revisión de registros, proveedores y cualificaciones por categoría, supervisión de contratos, pool de cuentas fiscales, supervisión GEO / códigos vivos, control de riesgo de puntos, paquetes de servicio oficiales, plaza de modelos, revisión de publicaciones, cuotas de derechos, analítica de uso, hardware inteligente, versiones de términos, registro de cambios, actualización de la plataforma y configuración del sistema | — |
| Ayuda y documentación | Centro de ayuda `/help` | Base de conocimiento versionada por capítulos (inicio rápido / herramientas del workbench / contenido y marketing / distribución multiplataforma / hardware inteligente / negocio y ajustes de gestión); la ayuda general se organiza por rol (empresa o usuario personal, proveedor de servicios, empleado del proveedor) pero es visible para todos, mientras que las secciones de administración de plataforma y de operación y despliegue en Alibaba Cloud solo son visibles para el administrador; ese mismo conocimiento se expone como herramientas MCP de solo lectura, así que se puede preguntar directamente a Agent para obtener el uso oficial | No |

---

## 📖 Detalle de funciones

### 1. Cuenta, identidad y sesión

- **Circuito cerrado de cuentas local**: registro (con canal opcional de usuario / correo / móvil), inicio de sesión, recuperación, cambio de contraseña, cambio de vinculación y baja; registro de inicios de sesión y bloqueos a nivel de plataforma.
- **Métodos de inicio de sesión y verificación de registro**: la página de acceso dibuja dinámicamente según los interruptores del panel «Acceso normal (cuenta + contraseña) / código por correo / código por móvil / escaneo de WeChat»;
  el registro dibuja «usuario / correo / móvil» según los métodos que haya activado el administrador; el registro por correo y por SMS exige superar antes la verificación de código (el correo necesita SMTP configurado y el móvil, Alibaba Cloud SMS;
  los métodos sin canal configurado no se pueden marcar en el panel y no se muestran en el sitio). Marcar «inicio de sesión automático durante 30 días» prolonga la sesión a 30 días.
- **Inicio de sesión / registro por escaneo de WeChat**: escaneo de la aplicación web del sitio en la plataforma abierta de WeChat; si ya está vinculado se entra directamente, y si no lo está y el registro automático está activo se crea la cuenta y se vincula
  (usuario `wx_<últimos 8 dígitos del openid>`, con apodo y avatar precargados); si el registro automático está desactivado se guía al usuario a confirmar su identidad con cuenta y contraseña o con código por correo / móvil y luego vincular; el `state` del escaneo es de un solo uso y dura 5 minutos,
  el AppSecret se guarda cifrado y el panel solo lo devuelve enmascarado.
- **Panel «Configuración del sistema → Cuenta e inicio de sesión»**: mantiene de forma unificada los métodos de registro, los métodos de acceso, SMTP, Alibaba Cloud SMS y los parámetros de WeChat; antes de activar un canal hay que tener completas sus credenciales.
- **Normalización a minúsculas de usuario y correo**: la ordenación de MySQL no distingue mayúsculas y la de PostgreSQL sí, así que todo se guarda y se desduplica en minúsculas para que el comportamiento sea idéntico en ambas bases; en bases existentes puede
  reescribirse de forma idempotente con `pnpm --filter aiworkin-enterprise-api db:normalize-usernames`.
- **Sesión autoemitida por este sitio**: solo se aceptan sesiones SSO emitidas localmente (emisor `enterprise-sso`, clave derivada de `JWT_SECRET` mediante HKDF);
  en cada petición se comprueban el estado de la cuenta y el `tokenVersion`, de modo que cambiar la contraseña, reasignar la vinculación o bloquear invalidan la sesión de inmediato; los tokens de la plataforma upstream se rechazan siempre.
- **Revisión de inscripción de los productos ya persistidos**: los compartidos públicos antiguos, las descargas de archivos exportados, los tokens del plugin de Chrome, las tareas programadas sin supervisión, los disparos temporizados o por evento de los flujos de trabajo y la pertenencia a proyectos de organización de low-code revisan antes de usarse, contra las tablas vigentes, «estado de la cuenta + relación inscrito en la organización», y caducan al momento si la persona deja la empresa o cambia de rol (sin esperar a la limpieza asíncrona de miembros del proyecto ni a la caché); hacia fuera se responde siempre «no existe / caducado», sin revelar el motivo.
- **Multidentidad y tipos de entidad**: cuatro identidades —administrador de plataforma, usuario de empresa, proveedor de servicios y empleado del proveedor (representante)—;
  las entidades se dividen en tres clases: empresa, autónomo persona física y persona física. Al cambiar de identidad, la barra lateral se reorganiza por identidad: el administrador de plataforma solo ve el panel de administración de la plataforma
  (con los cinco grupos Usuarios y proveedores / Supervisión operativa del negocio / Facturación y productos / Capacidades y seguridad / Sistema y contenido, y la visión general de datos integrada en el cockpit `/dashboard`),
  sin el bloque «Ajustes de gestión» propio de la vista de cuenta personal.
- **Verificación y cualificaciones**: los datos de la empresa se aplican al enviarlos; el registro del proveedor de servicios requiere revisión de la plataforma; el personal debe vincularse o adscribirse a un proveedor.
- **Código de invitación**: cada cuenta tiene su propio código de invitación; introducirlo al registrarse crea la relación de invitación; «Mis invitaciones» muestra el código, el enlace de registro, quién te invitó y a cuántas has invitado; «Invitar a registrarse» en el desplegable del avatar de la cabecera lleva directamente a esa página.

### 2. Cockpit

- Accesos rápidos en la esquina superior derecha de la cabecera: **Gestionar API Key** y **Recargar puntos**, y detrás el botón de identidad («Panel de administración» para el administrador, «Identidad y cualificaciones» para las demás); si no hay AIPDD API Key vinculada aparece además, en el extremo izquierdo, un botón rojo **Vincular AIPDD API Key** que lleva directo al bloque de vinculación de «Gestión de API Key» y desaparece solo al completarla.
- Tarjetas de estadísticas: **«Mis tareas» siempre en primer lugar** (toma los pendientes del centro de tareas y lleva a `/tasks` al pulsarla) y **«Contratos vigentes» siempre al final**; las demás tarjetas con página propia se pueden pulsar para ir directo. Cada identidad tiene su juego de tarjetas —empresa (Mis tareas / Pendientes / OA por aprobar / Mensajes nuevos / Contratos vigentes), proveedor de servicios (Mis tareas / Empresas atendidas / Pendientes / OA por aprobar / Contratos vigentes), empleado (Mis tareas / Entidad vinculada / Empresas atendidas / Pendientes / OA por aprobar) y administrador de plataforma (Mis tareas / Pendientes / Mensajes nuevos)—.
- El primer bloque bajo las tarjetas es la **navegación rápida**: por defecto muestra los accesos frecuentes con toda la tarjeta clicable, y «Configurar» arriba a la derecha permite añadir, quitar y reordenar, con persistencia por cuenta; después siguen, para la identidad de empresa, el **cockpit de crecimiento** (progreso de objetivos, cobros, proyectos en entrega, conversión de captación, conversaciones de atención derivadas a prospecto), los «Pendientes» (suma de lo no terminado por sección; las categorías de servicio no contratadas se ocultan según la identidad), el **Top5 de Mis tareas** (cada fila salta al módulo de origen), y la visión de «Pendiente de mí» y mensajes nuevos.
- **«Pendiente de mí» admite una única fuente: el `bySource` del centro de tareas** (mismo origen que `/tasks`): solo lista los asuntos atribuidos a la persona y con volumen actual (consultas del sitio web, OA, CRM, OKR, proyectos, flujos de trabajo, contratos por confirmar, revisiones de plataforma); «las invitaciones de vinculación que debo confirmar» no pertenece a ninguna fuente de tareas y se añade como fila aparte.
- Administrador de plataforma: el cockpit es la visión general de datos de la plataforma (registros / empresas / proveedores / contratos / documentos de cada negocio e impuestos), las revisiones pendientes (registro de proveedores) y la distribución de tipos de servicio de los proveedores; la barra lateral lleva directamente a cada sección de supervisión.

### 3. Workbench (21 accesos)

| Módulo | Capacidades principales |
|---|---|
| **Mis tareas** | Centro de tareas unificado: reúne en una pantalla ocho clases de pendientes —aprobaciones de OA, quehaceres de OKR, tareas de proyecto, pendientes de CRM, conversaciones de atención, confirmación de contratos, revisiones de plataforma y nodos humanos de flujos de trabajo— (todo lo de ámbito de la cuenta, con filtros por origen / grupo + búsqueda + paginación); cada fila muestra solo la presentación de la tarea, el estado en el centro y el estado en el negocio y el acceso para gestionarla, porque el detalle se tramita en el módulo de origen. El estado del centro (pendiente → en curso → completado / cancelado / caducado) se presenta aparte del estado autoritativo del negocio; el propio usuario puede cerrar y reabrir (con confirmación de contraseña) y los estados finales del módulo de origen se cierran automáticamente. El cockpit tiene además un panel Top5. |
| **Agent** | Conversar con el modelo y producir directamente imágenes / vídeos cuyos resultados se guardan solos en los activos digitales AIPDD de esta cuenta; la memoria a largo plazo, la biblioteca de material y la memoria operativa se integraron en la pestaña «Memoria» de «Base de conocimiento» (material y memoria a largo plazo viven ambos en la base de conocimiento, y Agent mantiene en todo el sitio un único criterio de recuperación); el umbral de autorización «Acciones ejecutables automáticamente» cuelga de la pestaña de conectores MCP y gestiona dos autorizaciones: las acciones de contrato y las herramientas de los conectores MCP propios (las herramientas del conector se rechazan por defecto y se abren marcando el conector completo; sin autorización solo se devuelve un borrador y en modo sin supervisión nunca se ejecutan). Al subir habilidades o plugins pasan primero por una revisión de seguridad con IA (con la clave y el modelo que configures en «Configuración de modelos») y solo entran si la superan; las que declaran permisos exigen confirmación antes de activarlas; en ejecución hay salvaguardas de número de llamadas, llamadas repetidas y respaldo de salida. Modelos y claves se configuran en «Servicios de modelo → Configuración de modelos». |
| **Flujos de trabajo** | Orquestación visual multipaso: arrastra nodos y conexiones en el lienzo; el catálogo de nodos se deriva del registro unificado de capacidades (acciones de contrato, herramientas integradas / de negocio / de conector / de hardware / de habilidad / de plugin, y nodos integrados de disparo / bifurcación condicional / paralelo y convergencia / IA / humano / Webhook) y los formularios de parámetros se generan solos desde el contrato; al crear puedes partir de 5 plantillas de recetas integradas (seguimiento de captación / renovación de contratos / reclamación de cobros / control de calidad de tickets / alta de incorporaciones), que precargan nombre y descripción y traen el diagrama, con el destinatario asignado por defecto al propio iniciador, de modo que copiar y pegar ya funciona; también puedes pulsar «Crear con IA» y describir la necesidad en una frase o unos turnos, y el modelo de texto reescribe el lienzo actual a partir de los nodos existentes del sistema (supera la misma validación de DAG antes de aceptarse, y lo que no puede mapear se deriva al nodo «Agente de IA»), y al pulsar «Aplicar al lienzo» se escribe en el lienzo y luego se guarda; guardar borrador → prueba paso a paso en el Playground (entrada / salida / duración / error de cada paso) → publicación que congela la versión. El runtime hace detección de ciclos del DAG y resuelve variables de plantilla (`{{input.x}}` / `{{vars.x}}` / `{{nodes.id.x}}` / `{{actor.userId}}`); los nodos humanos quedan suspendidos y se reanudan al cerrarse desde «Mis tareas»; los flujos compartidos entran en el catálogo de Agent del sitio y de herramientas MCP como `wf__<id>`. Antes de cualquier disparo temporizado, por evento de dominio o por evento de tarea se revisa contra las tablas vigentes la cuenta del iniciador y su inscripción en la organización, así que al salir de la empresa o ser retirado de la organización ya no se inician procesos automáticamente. La lista se agrupa en «míos + una pestaña por entidad» (`Empresa A · Compartido por empresa` / `Proveedor C · Compartido por proveedor`, con el nombre de la entidad tomado de las organizaciones del usuario, truncado y con nombre completo al pasar el ratón); el dominio de datos de cada entidad está aislado y jamás se mezclan entidades en un mismo listado, aunque al crear puedes elegir a qué empresa o a qué proveedor de servicios se comparte. |
| **Base de conocimiento** | Lanza actas, artículos y transcripciones de llamadas a un espacio de conocimiento y el sistema los compila en páginas wiki trazables: los `[[enlaces]]` del cuerpo hacen crecer automáticamente el grafo de conocimiento, la búsqueda híbrida (palabras clave + vectorial) y las respuestas con citas están disponibles mientras escribes y, sin modelo grande conectado, todo el recorrido cae en un respaldo determinista basado en reglas; las pestañas cubren espacios, material, páginas, preguntas y respuestas, grafo, consumidores y memoria. El rastro de lo que hace el agente puede destilarse como **memoria operativa**, y el contexto previo a la respuesta vuelve a fluir desde ahí; la memoria a largo plazo y la biblioteca de material viven ambas en la base de conocimiento, que es la única fuente de recuperación de Agent en todo el sitio. |
| **Workbuddy Cloud empresarial** | Tareas planificadas: el lenguaje coloquial se aclara con IA hasta convertirse en un encargo, se parte y se asigna y se sincroniza con los mensajes del Agent; Agent: creación / versiones / conversaciones; cuentas de Workbuddy Enterprise: el SecretId / SecretKey del usuario guardados cifrados, con varias en paralelo; cuentas de llamada a IA: contraseñas de terceros / API Key / cookies cifradas, autorizadas y ligadas a la cuenta de la nube empresarial y consumidas por el canal máquina según la vinculación. |
| **Tablas multidimensionales** | Tablas de datos estructuradas de creación propia atribuidas por cuenta: columnas personalizadas (ocho tipos), filas capturadas una a una y lectura y escritura por canal máquina con API Key; ofrece además accesos de sincronización con las tablas multidimensionales de Feishu y su callback de eventos. |
| **Automatización RPA** | Tareas RPA (crear la tarea ya vincula script + cuenta + parámetros de ejecución), cuentas RPA (contraseñas cifradas) y scripts RPA (JSON de Automa / JS / Python, que un modelo de texto de AIPDD puede generar a partir del enunciado); el navegador Bit local recluta y ejecuta con una API Key y devuelve el resultado. **Agente de navegador (Chrome local)** — la misma extensión AIPDD Enterprise inicia sesión con tu cuenta del sitio y pasa a ser un dispositivo en línea: el LLM en la nube puede decidir paso a paso mientras la extensión ejecuta en tu navegador (devuelve el mapa de la página y capturas, se detiene en acciones sensibles para confirmación manual, se puede detener en cualquier momento y nunca recibe las credenciales de las plataformas objetivo), o pulsa Alt+A para abrir el **panel lateral** de la extensión, describe el resultado en una frase y el Agent planifica y actúa de forma autónoma, en varios pasos, en los sitios donde ya has iniciado sesión, devolviendo resultados estructurados; tres modos Act / Crawl / Extract, con modelos de la plaza de modelos del sistema y medidos en puntos de la plataforma. Puedes guardar **habilidades** (conocimiento personal / por sitio) y **grabaciones → herramientas** (se reproducen por la misma ruta de ejecución local que el Agent, los campos de contraseña nunca se graban), y trae un **MCP** por defecto: mientras el dispositivo esté verde (en línea), el Agent de la plataforma y los clientes MCP externos pueden enviarle tareas por `/api/v1/mcp` con las herramientas `browser_*`. También puedes vincular una secuencia de acciones determinista (chrome_actions) para reproducirla sin LLM, o iniciarla y programarla desde Agent / MCP y la pestaña «tareas RPA matriciales» sobre un dispositivo en línea. El panel lateral también permite crear **tareas programadas** (única / frecuencia recurrente) para que este dispositivo en línea ejecute automáticamente un objetivo al vencer; si el dispositivo está desconectado, esa ronda se omite (sin recuperación), y desactivar la cuenta la pausa automáticamente. |
| **Creación de contenido** | Tarjetas de herramientas en una pantalla: texto a imagen, texto / imagen a vídeo, replicación de vídeos, vídeo con persona digital, cambio de persona o de producto en vídeo, retoque y limpieza de marcas de agua, extracción de guion de audio y vídeo, síntesis de voz, creación de música, doblaje de vídeo, remix de vídeos cortos, inversión de guion desde vídeo y textos locutados / artículos para cuentas oficiales; dos tarjetas de optimización de fichas de producto (**ficha de producto para e-commerce transfronterizo**: paquete de imágenes en inglés para Amazon / Etsy / tienda propia, con imágenes principales y de detalle impulsadas por la razón de compra; **ficha para e-commerce nacional**: paquete de imagen de detalle larga de 750px para Taobao / Tmall / JD / Pinduoduo / Douyin, con textos que respetan las palabras absolutas prohibidas por la ley de publicidad): se crea el paquete → el modelo grande produce el plan (razón de compra, candado de estilo, prompt por imagen) → se generan las imágenes una a una, y el campo «descripción por imagen» permite alinear la salida con el orden imagen principal 1..N / imagen de detalle 1..N; al final está la «herramienta de creación de vídeo» (AIPDD Drama Agent, acepta pegar directamente una API Key de AIPDD / AIworkin). La superresolución y la eliminación de marcas de agua de vídeo usan el MediaKit de Volcengine: hay que añadir el canal MediaKit en Configuración de modelos y rellenar la clave para que aparezca; la «comunidad de plantillas de vídeo» ordena por uso / novedad / más guardadas y busca por palabra clave, se publican muestras + imágenes de referencia + prompt, ver la receta puede costar puntos (lo visto acredita puntos al autor) y «usar el efecto» lleva la receta al generador para replicarla con el modelo propio. Los resultados generados entran solos en los activos digitales. |
| **Herramientas de marketing** | Los accesos se agrupan en cuatro bloques según la cadena de negocio: captación y conversión, contenido y crecimiento en buscadores, datos y minería de prospectos, y contacto y operación de clientes; cada tarjeta es clicable por completo. SCRM de WeCom (el SCRM nativo es la única fuente de sincronización de clientes: espejo de clientes / etiquetas / grupos, códigos vivos y mensajes de bienvenida, etiquetado automático, envíos masivos a clientes (la confirmación humana no se puede desactivar), herencia en activo y en salida, SOP y H5 de barra lateral para empleados, bloqueo de palabras sensibles en salida y solo aviso en entrada, control de calidad IA en cuatro dimensiones; al activarlo se pausa automáticamente la importación de clientes de Qidian para evitar dobles escrituras), conexión con creadores (filtrado por categoría / plataforma / seguidores y consulta de contactos), llamadas salientes inteligentes de Alibaba Cloud (mapeo de listas de tablas multidimensionales a grupos de tareas de llamada), envío de correo de Alibaba Cloud (sincronización de contactos a la lista de destinatarios de Alibaba Cloud), optimización GEO para motores de IA (visibilidad de la marca en respuestas de IA, pool de temas, recomendación de plataformas de publicación), optimización SEO (el análisis del sitio propio usa tu propio HTTP y es gratuito, investigación de palabras clave y diccionarios, seguimiento de posiciones, análisis competitivo, auditoría y construcción de enlaces, SEO local por cuadrícula, páginas programáticas por lotes, datos estructurados y envío de indexación IndexNow / Search Console de Baidu (JSON-LD exportable en .json), informes SEO y compartición desidentificada (exportables en Markdown / HTML autocontenido), conversión con un clic de diccionarios y de consultas «a tu alcance» de GSC a seguimiento de posiciones o a preguntas de monitorización GEO, sincronización de prospectos de enlaces a la lista de destinatarios de Alibaba Cloud Mail (solo sincroniza, no envía), guardado de páginas programáticas como activos de contenido con un clic; con una clave DataForSEO de pago propio del usuario se desbloquean volúmenes reales de búsqueda / posiciones / enlaces, y sin clave no se inventan datos, solo se guía a configurarla; la interpretación con IA usa el modelo del sistema y consume puntos; los enlaces de dominio propio publicados con éxito en el libro de distribución pueden enviarse a indexación con un clic), captación con códigos vivos (punto de entrada fijo + varios subcódigos repartidos al azar / en orden / por peso, con límites, persistencia de visitante y estadísticas por canal; los enlaces cortos usan tu propio dominio), Tencent Qidian (datos de clientes / operación en WeCom / contacto con miembros, y los clientes pueden escribirse en el CRM de este sistema), minería de prospectos en Google, cinco herramientas de macrodatos globales (datos de empresas / comercio global / profesionales globales / creadores globales / POI globales) y gestión de ventas con IA SalesBuddy; **distribución multiplataforma**: un contenido se publica a la vez en 13 canales mediante el plugin de navegador AIPDD Enterprise (publicaciones con imágenes: Weibo / Xiaohongshu / Douyin / Kuaishou / Channels / Zhihu Xingqiu; artículos: Zhihu / Toutiao / Baijiahao / columna de Bilibili / cuenta oficial / Jianshu / Douban), el cuerpo se escribe en un editor enriquecido, se limpia con lista blanca antes de guardarse y el plugin lo degrada automáticamente a HTML con estilos / Markdown / texto plano según lo que admita cada canal; los estados borrador —pendiente de distribuir— entregado —éxito / error y el resultado por plataforma quedan en el libro de este sistema, y la publicación ocurre en tu navegador ya autenticado, de modo que las credenciales de las plataformas nunca salen de tu máquina; **diseño de encuestas e investigación**: pregunta a pregunta (opción única / múltiple / texto corto / texto largo / número / fecha / puntuación), al publicar se genera un enlace de respuesta sin inicio de sesión y un código QR, cada respuesta se escribe sola en una tabla multidimensional exclusiva de la encuesta (filtrable, exportable y sincronizable con Feishu) y el panel agrega por pregunta la proporción de opciones y las medias numéricas; una vez publicada y con respuestas, las preguntas se bloquean para que la serie histórica sea coherente; **biblioteca de habilidades de marketing**: siete familias —contenido / redes / correo / SEO / publicidad / investigación / ventas— con contexto de marca, que se ejecutan rellenando parámetros, producen con reglas si falta la clave del modelo, depositan el resultado como activo de contenido y admiten conexión / llamada de capacidades de canal, evaluación de la ejecución y tareas programadas. |
| **Gestión de activos digitales** | Totalmente sincronizada con los activos digitales de AIPDD: consulta por archivo / imagen / vídeo / audio, etiquetado y subida directa (al subir se registra en la plataforma y no se guarda copia local); las tarjetas de activos se fijan de cuatro por fila y no se estiran según la cantidad. Existe además la pestaña «Materiales compartidos», que comparte activos de esta cuenta con otras cuentas de **la misma organización**: las empresas certificadas comparten entre miembros de la empresa y los proveedores de servicios entre su responsable y el personal en activo (se reconocen ambos registros de adscripción, `org_staff` y `provider_staff`); al compartir solo se toman activos del libro de esta cuenta, el destinatario debe estar en la lista de la propia organización, se puede elegir varias o todas y retirar en cualquier momento; compartir solo registra la relación de pertenencia, el archivo sigue siendo del autor. |
| **Servicio de correo IA** | Se añaden varias cuentas de correo (POP3 / IMAP) por cuenta de acceso, con lectura en tiempo real de bandeja de entrada y borradores, y **los cuerpos y los adjuntos nunca se guardan en la base**; pueden configurarse guiones por escenario y elegir como modo de respuesta «solo redactar borrador» o «redactar borrador y responder automáticamente»; las tareas programadas de Agent redactan la respuesta siguiendo el guion mediante la herramienta de correo; la lista muestra los enviados / borradores hechos hoy y el acumulado mensual procesado. Incluye la pestaña **plantillas de correo**: variables de plantilla, vista previa en sandbox y envío de prueba a un correo indicado. |
| **CRM** | Gestión de clientes por cuenta: prospectos, clientes, oportunidades, contratos de venta, cobros, pedidos, aprobaciones e informes, con registros de seguimiento y asistencia de IA; los miembros y los permisos reutilizan los «empleados y representantes» de esta cuenta. La pestaña **seguimiento de presupuestos** genera PDF de presupuesto con plantilla (clásico / moderno / minimalista) y el enlace público lleva registro de visitas y de envíos. Cuando un pedido se aprueba se crea el proyecto de forma automática e idempotente por «misma organización + mismo pedido», con el presupuesto tomado del importe del pedido y el responsable del proyecto sincronizado, y el detalle del pedido muestra «proyecto creado automáticamente #id»; la conversión de prospecto a cliente se devuelve al contacto del SCRM de WeCom y las conversaciones de atención al cliente IA pueden pasarse a prospecto CRM con un clic. El detalle 360 del cliente tiene además una pestaña «WeCom»: busca los contactos de WeCom de ese cliente, su empleado responsable, las etiquetas y la última interacción. |
| **BI inteligente** | BI por cuenta: conjuntos de datos CRM curados integrados + fuentes externas PostgreSQL / MySQL de solo lectura; admite consultas inteligentes, gráficos y paneles. |
| **OA** | Solicitud por formulario y aprobación multinivel con pertenencia organizativa: vacaciones, gastos, pagos, compras y uso de sello; los miembros salen de «empleados y representantes», pueden enlazarse datos de negocio como CRM, el resultado de la aprobación se devuelve al negocio y hay avisos y quehaceres programadas. Al crear una solicitud, **un borrador con IA a partir de una frase**: describes el asunto y empareja la plantilla y rellena los campos automáticamente, para revisar antes de enviar. |
| **Planificación OKR** | Con pertenencia organizativa: ciclos anuales / trimestrales / mensuales, árbol de objetivos de la empresa a la persona, planes semanales / diarios, informes diarios y semanales y evaluación de la retrospectiva del ciclo. La pestaña **despliegue con IA** sigue el recorrido «documento de objetivo → aclaración interactiva → tres propuestas candidatas → validación simulada → confirmación humana y alta en base»: el documento registra el objetivo de negocio global y el triángulo de hierro del proyecto (alcance / plazo / presupuesto / personas / medios / equipos / servicios externos) y antes de desplegar se hace una comprobación previa (ciclo, miembros, entregables, entidades externas); la IA emite cada ronda solo preguntas estructuradas e hipótesis, y responsables, fuente de los indicadores, importes y fechas se validan contra la lista blanca de la organización y la entrada del usuario, de modo que sin modelo se usa una propuesta por reglas claramente marcada como «reglas» y hasta confirmar no se crean objetivos, KR, tareas, vínculos entre tareas, OKR personales ni proyectos; las tareas llevan criterios de aceptación, nivel de calidad y peso de evaluación, y puede previsualizarse la puntuación calculada por KR / tarea. Cada objetivo abre el cajón «detalle»: progreso, resultados clave, tareas vinculadas (peso / valor devuelto / ítems de aceptación) y registros de progreso (marcando origen manual / automático / planificado / del sistema y los valores antes y después). |
| **Workbench de RR. HH.** | Cinco pestañas básicas de expedientes, asistencia y vacaciones, reclutamiento, entrevistas y ofertas y evaluación del talento, más **gestión de agendas** (franjas ocupadas / libres, enlace público de cita, libro de reservas), **incorporación** (plantillas por rol → el alta de inicio se dispara al aceptar la oferta → cierre ítem a ítem) y **transcripción de voz** (transcripción de entrevistas y conversaciones, resumen con IA y devolución de puntuaciones); los miembros y permisos reutilizan los «empleados / representantes» de la organización y el lado de reclutamiento comparte las mismas vacantes que la plaza de empleo de contactos de negocio. |
| **Gestión de proyectos** | Ficha de proyecto, miembros e hitos, iteraciones y dependencias entre tareas, horas registradas y aprobación de partes semanales; la IA propone el despliegue WBS y evalúa la salud del proyecto y el resultado se escribe de una sola vez tras confirmación humana. La pestaña **costos** calcula el costo de mano de obra como «horas aprobadas × tarifa vigente», registra por separado materiales / equipos / servicios externos y muestra en tiempo real la ocupación del presupuesto y las horas sin tarifa asignada; la pestaña **colaboración externa** mantiene el catálogo de proveedores / OPC / personas / socios y las órdenes de colaboración (borrador → ejecución → por aceptar → liquidación / cancelación), y al aprobar la aceptación se genera automáticamente el ítem de costo externo. Las tareas admiten tres formas de ejecución —personal interno, adjudicación de tareas y colaboradores externos— y pueden llevar criterios de aceptación, nivel de calidad y peso de evaluación. Una tarea puede **publicarse como demanda externa**: se difunden alcance / entregables / presupuesto / plazo / criterios de aceptación a entidades externas, se recogen ofertas y plazos comprometidos y, al aceptar una, el sistema crea la orden de colaboración externa, reasigna la tarea e integra esa colaboración en la aceptación y en los costos. La pestaña **auditoría de horas** deja rastro del antes y el después de cada modificación y agrega por persona, y la pestaña **sincronización de tareas** soporta sincronización bidireccional con Jira / Teambition / TAPD. Proyectos y tareas llevan el cajón «colaboración»: comentarios / respuestas / @ a compañeros, etiquetas, enlaces de recursos y favoritos, con limpieza por lista blanca antes de guardar los comentarios y @ limitado a miembros inscritos en la organización, con notificación interna. El detalle del proyecto añade dos pestañas resumen, «entrega» y «costes»: entrega muestra tareas completadas / en curso / vencidas y el peso de aceptación, y costes muestra presupuesto, costo incurrido, consumo presupuestario, colaboraciones externas y horas registradas (el mantenimiento se sigue haciendo en la pestaña «costos» del proyecto). |
| **Compras-ventas-inventario** | Productos / variantes / categorías / almacenes, movimientos y transferencias de stock, aprobación de salidas, órdenes de compra y entradas, proveedores, cuentas por cobrar y por pagar y cobros y pagos, gastos, impuestos y políticas de precio; la IA da insights de gestión en cuatro frentes —stock / compras / cobros / flujo de caja— y produce con reglas si no hay clave de modelo configurada. |
| **Atención al cliente IA** | Atención por cuenta: una cuenta puede colgar varios sitios oficiales y el visitante entra desde la ventana de atención del sitio (iframe del mismo dominio `/embed/service-desk`) para recibir a personas del propio organización (empleados / representantes); incluye ocho pestañas: conversaciones, **tickets de posventa**, equipo de atención, configuración de recepción, frases frecuentes y conocimiento, sitios e integración, canales y estadísticas. Los tickets de posventa siguen una máquina de estados pendiente → revisión → aprobado / recepción de la devolución / envío → completado, con línea de tiempo de eventos. El estado de recepción es en línea / ausente / desconectado y solo en línea participa en la asignación automática; la IA aplica según la configuración textos fijos, sugerencias de respuesta o respuesta automática, el modo automático puede derivar a una persona en cualquier momento y el modo solo-IA no deriva. |
| **Centro de aplicaciones** | Acceso unificado a las aplicaciones integradas y al mercado: la portada busca por palabra clave entre «las que construí / las construidas por mi empresa / las del mercado», y hay cuatro pestañas: creadas por la empresa, creadas por mí, en las que participo y mercado de aplicaciones. Las aplicaciones integradas se materializan en tablas multidimensionales y los miembros leen y escriben según su rol; el mercado es solo una presentación de lectura del catálogo público externo: este sitio no guarda las aplicaciones ni publica ni valora en nombre de nadie. |
| **Sala de temas** | Publica debates temáticos internos de la empresa o públicos: los internos los participan los empleados de la propia organización y de los socios contratados / encargados, y los públicos están abiertos a todas las cuentas con sesión iniciada; quien inicia puede cerrar el tema (la IA resume todas las intervenciones y respuestas), volver a cerrarlo, cerrarlo a comentarios o eliminarlo; al intervenir se puede firmar como persona o como avatar digital. |

### 4. Servicios de negocio (11 líneas + mercado de oferta y demanda)

Forma unificada: **biblioteca de recursos de proveedores** (listado → detalle → iniciar contratación) + **información de demandas / mercado de servicios** + **libro de negocio**.
El proveedor debe primero completar su registro y superar la cualificación de la categoría correspondiente para que sus recursos se muestren; si en una sección hay un solo proveedor no se lista, se incrusta directamente su detalle.
El mercado de oferta y demanda es un mercado público transversal a todas las secciones y no aplica el control de registro por sección; los listados de demandas y de servicios se muestran **paginados** (sin scroll infinito),
con filtros por **zona (provincia / ciudad) y subcategoría** y con la columna de categoría (nivel 1 / nivel 2) en cada fila; además de ambos listados hay una pestaña de **valoraciones** (distribución de puntuaciones y libro de reseñas), cuyos datos alimentan también la puntuación visible del proveedor.

Los listados de **demandas / servicios** de cada mercado de servicios y del mercado de oferta y demanda tienen el par de filtros «**todos (demandas / servicios)** / **publicados por mí**»:
«todos» lee directamente el pool público de la categoría correspondiente de AIworkin; «publicados por mí» lee el libro de este sistema (la publicación se guarda primero en local,
luego se sincroniza a la plataforma y se devuelve su ID de contenido). Según el criterio de usuario del 2026-11-09, «publicados por mí» **solo se dibuja para la identidad de proveedor de servicios**,
y nunca aparece para la identidad de empresa (solo «todos»); los registros ya publicados oficialmente en AIworkin no se editan ni se borran desde este sistema,
solo se deja «ver» —las interfaces de escritura REST de la plataforma (PATCH / DELETE) devuelven 401 a la API Key y MCP tampoco ofrece herramientas de modificación o borrado—.
El **mercado de servicios** (logística / marketing / internacionalización / empleo flexible / TI / propiedad intelectual / legal / consultoría / activos / suministro y distribución / fiscal y contable) usa siempre la clave de menú «mercado de servicios de ××»,
con el mismo detalle: todos los servicios = pool público de la plataforma, servicios publicados por mí = libro local; red de suministro y servicios fiscales y contable se renombraron e integraron así el 2026-11-09 desde
«publicación de servicios» (usuario: «unificar con los demás mercados, para ver a la vez el pool público y mis publicaciones»).
**La pestaña de mercado de la red de suministro también se muestra a las empresas** (2026-11-09): el mercado es navegable por todos, lo único que la empresa no puede publicar servicios:
el acceso «publicar servicio» no se dibuja según la identidad, tampoco aparece el filtro «servicios publicados por mí» y el backend intercepta con el mismo criterio mediante `assertPublishAllowed`.

| Sección | Contenido |
|---|---|
| Servicios de marketing | Creadores que visitan locales / venta en directo · canal de mensajes de demandas |
| Red de suministro y distribución | Colaboración B2B de oferta y demanda: estaciones de servicio, pedidos de mercancías, reserva de servicios presenciales (la cotización la remata el proveedor o el empleado que designe) y mercado de servicios de la red de suministro |
| Servicios fiscales y contables | Material de declaración, plan de declaraciones, gestión de libros, capacidades automatizadas, información de demandas y mercado de servicios fiscales; el plan se genera solo según la condición de contribuyente (general / pequeño) y la frecuencia (mensual / trimestral / anual) de las empresas contratadas; con la capacidad de la empresa habilitada, Qixiangyun puede presentar declaraciones automáticas, emitir facturas y consultar las emitidas |
| Internacionalización | Proveedores de servicios de comercio transfronterizo y herramientas de servicio de internacionalización |
| Empleo flexible | Biblioteca de recursos, demandas de empleo (incluida la tramitación de alta) y nóminas de empleo flexible (interruptor a nivel de plataforma, activo por defecto) |
| Servicios de logística | Transporte terrestre nacional / agencias de carga transfronterizas · canal de mensajes de demandas |
| Servicios de TI | Implantación de IA / desarrollo de software / cómputo / hardware / datos · canal de mensajes de demandas |
| Propiedad intelectual | Biblioteca de despachos / agentes, mensajes de demandas y consultas y defensa de derechos |
| Servicios legales | Biblioteca de abogados y despachos y mensajes de demandas |
| Servicios de consultoría | Biblioteca de instituciones / expertos y mensajes de demandas |
| Intercambio de activos | Alquiler y venta de activos y servicios de intermediación · canal de mensajes de demandas |
| Mercado de oferta y demanda | Mercado público transversal: **dos pestañas, demandas y servicios**, cada una con los filtros «**todos (demandas / servicios)** (pool público de la plataforma AIworkin, leído por el canal de la plataforma, navegable incluso sin clave vinculada) / **publicados por mí** (libro de este sistema, solo se dibuja para la identidad de proveedor de servicios)»; la publicación se registra primero en el libro de este sistema y luego se sincroniza a la plataforma, devolviendo su ID de contenido, y una vez publicada solo se ofrece «ver» desde aquí (ni la escritura REST ni MCP admiten modificar o borrar); ambos listados van paginados (sin scroll infinito) y admiten filtro por zona y subcategoría; cualquier cuenta con sesión iniciada puede publicar y el contenido pasa por la revisión automática de publicación |

- **Contratación**: la empresa inicia → el proveedor de servicios confirma → se entra en el libro de contratos; el administrador de plataforma puede resolver contratos vigentes desde «Supervisión de contratos».
- **Paquetes de servicio oficiales**: las columnas de proveedores de cada sección de negocio muestran los paquetes oficiales de la plataforma (precio de referencia en RMB + precio en puntos convertido con el tipo de cambio del panel), que la empresa compra directamente con puntos; tras la compra es la plataforma quien media la contratación ítem a ítem entre la empresa y varios proveedores de calidad, con el criterio de que «este paquete lo entrega la plataforma integrando proveedores de calidad», y toda contratación entra en vigor solo tras la confirmación del proveedor (incluso con proveedor predefinido se inicia de forma automática pero nunca se confirma sola), con el progreso de entrega leído en tiempo real del estado del contrato. El panel «Paquetes de servicio» mantiene el catálogo y la cola de entrega (emparejamiento, inicio mediado, cambio de entidad, reembolso parcial o total), el límite de compra cuenta por empresa y los paquetes no participan en la gestión de plazos de entrega ni de vencimientos; del lado de usuario, «Mis paquetes» muestra los adquiridos y el progreso ítem a ítem.
- **Habilitación de capacidades**: la declaración electrónica y la facturación electrónica son capacidades de pago que el proveedor configura para cada empresa atendida; la empresa solicita la habilitación y la plataforma revisa;
  la activación / desactivación a nivel de empresa y el emparejamiento de cuentas de Qixiangyun se gestionan de forma unificada en el panel «Gestión fiscal y contable».
- **Paneles de negocio**: los listados de **información de demandas** de las secciones fiscal / suministro / internacionalización leen todos el libro de este sistema (`market_listing_records`),
  ya no leen directamente el pool público de la plataforma; la publicación se sincroniza a la plataforma AIworkin por el canal MCP unificado
  y devuelve el número de anuncio de la plataforma (ID de contenido) al libro local, y los registros ya publicados oficialmente solo se pueden «ver» desde este sistema. Desde
  el 2026-11-09 las **columnas de servicios** de esas secciones se unifican como «**mercado de servicios de ××**», leyendo el libro de servicios de este sistema (`provider_service_listings`)
  y alternando entre «todos los servicios / servicios publicados por mí» (todos = pool público de la plataforma), con la misma secuencia de publicar: guardar primero, sincronizar después y devolver el número de anuncio.
- **Mercado de oferta y demanda**: el acceso de menú está bajo «Servicios de negocio», la interfaz reutiliza `/enterprise/market/:domain/...` y
  `domain=HUB` representa lo transversal a secciones: las pestañas de demandas y servicios tienen el filtro «todos / publicados por mí» —«todos» lee solo el **pool público** de la plataforma
  (por eso sin clave vinculada nunca aparece un fallo de autenticación del canal) y «publicados por mí» lee solo el libro de este sistema (`scope=mine`, solo se dibuja para la identidad de proveedor de servicios);
  ambos admiten filtro por zona (provincia / ciudad) y subcategoría (las categorías se eligen sin importar la sección de negocio, con la categoría de nivel 1 en cada fila);
  los listados van por páginas y el siguiente tramo de cursor se pide solo al pasar página, sin acumular un scroll largo a la derecha del listado;
  la publicación escribe directamente en la plataforma con la AIPDD API Key vinculada a la cuenta actual y deja asiento local, y el contenido pasa igualmente por la revisión automática de seguridad de contenido de Alibaba Cloud;
  los registros ya publicados en la plataforma no se pueden modificar ni borrar desde aquí, solo «ver».

### 5. Contactos de negocio (social / reclutamiento / oferta y demanda)

- **Red social de negocios**: conectar con profesionales del sector (amigos / bloqueo), publicar novedades (público / solo amigos), grupos al estilo de Douban (descubrir / unirse a grupos, publicar por categorías,
  anonimato por entrada, respuestas por pisos y recomendaciones, fijar y destacar y aprobar altas por parte de dueño / administradores), mensajes directos internos y currículo profesional (página HTML independiente bifurcada del perfil,
  que se puede adjuntar en un mensaje directo y el empleador abre al momento y exporta a PDF). Si la cuenta está bloqueada, las funciones sociales se interceptan automáticamente.
- **Reclutamiento**: publicar vacantes de jornada completa / parcial / prácticas / temporales / cesión de trabajadores en el feed de la plaza de reclutamiento, con contacto por mensaje directo interno (se puede adjuntar currículo);
  este sistema no monta base de currículos ATS ni filtrado; con AIPDD Key vinculada las vacantes pueden sincronizarse como demandas de empleo de AIworkin (la categoría toma siempre el subárbol de «empleo flexible»).
- **Plaza de oferta y demanda**: publicación genérica de demandas / servicios que entra en el feed local, donde puede verse y contactarse por mensaje directo.
  La **publicación en dos fases** es el criterio central del proyecto: por defecto se publica en local sin clave; al marcar «sincronizar la publicación con AIworkin»,
  el resolutor unificado de credenciales llama con la clave vinculada por el usuario al upstream `POST /market/listings` y refleja de vuelta los estados de revisión / retirada del upstream.

### 6. Ajustes de gestión

| Módulo | Contenido |
|---|---|
| Identidad y cualificaciones | Los datos del usuario se aplican al enviarlos; el registro del proveedor de servicios requiere revisión; el personal debe vincularse o adscribirse |
| Gestión de empleados / representantes | Visión del equipo, aprobación de adscripciones y personal en activo; incluye el directorio de conexiones IM (Feishu / WeCom) con sincronización y callback |
| Gestión de contratos | Visión general y listado completo de contratos (iniciados por la empresa, confirmados por el proveedor) |
| Centro de puntos | Visualización de puntos y AWcoin como doble moneda, recarga, regalos, movimientos y pedidos; los **códigos promocionales** pueden descontar sobre el importe del pedido o convertirse en puntos (el administrador de plataforma mantiene el pool de códigos y, del lado del usuario, al canjearlos se acreditan) |
| Mis paquetes | Paquetes de servicio oficiales adquiridos y progreso de entrega ítem a ítem: la plataforma integra a proveedores de calidad para entregar y media la contratación entre la empresa y el proveedor, con el progreso leído en tiempo real del estado del contrato |
| Mis invitaciones | Código de invitación exclusivo, enlace de registro, relaciones de invitación y número de invitados |

### 7. Panel de administración de la plataforma (`/admin`, 26 secciones)

La barra lateral se organiza en 5 grandes categorías; la visión general de datos de la plataforma se integra en el cockpit directivo (`/dashboard`) y el menú lateral ya no conserva una sección de resumen independiente:

| Categoría | Sección | Descripción |
|---|---|---|
| Usuarios y proveedores | Usuarios registrados | Todas las cuentas: usuario, apodo, correo, estado de la cuenta |
| Usuarios y proveedores | Empresas | Usuarios que han superado la verificación de datos empresariales (empresa / autónomo persona física) |
| Usuarios y proveedores | Registro de proveedores | Revisión de las solicitudes de registro; al aprobarse se obtiene automáticamente el rol de proveedor de servicios |
| Usuarios y proveedores | Gestión de proveedores | Los proveedores registrados y sus cualificaciones por tipo de servicio, desactivables y reactivables una a una (al desactivar se retiran los recursos y se bloquean las altas de negocio de ese tipo) |
| Usuarios y proveedores | Habilitación de capacidades de proveedores | Revisión de las solicitudes de habilitación de pago de automatización fiscal y contable |
| Supervisión operativa del negocio | Empleo flexible | Interruptor a nivel de plataforma de la sección «nóminas de empleo flexible» (activado por defecto) |
| Supervisión operativa del negocio | Supervisión de contratos | Libro de todos los contratos; permite resolver contratos vigentes |
| Supervisión operativa del negocio | Supervisión de la red de suministro | Visión de toda la plataforma de estaciones de servicio, pedidos de mercancías y órdenes de reserva de servicio presencial |
| Supervisión operativa del negocio | Supervisión de códigos vivos | Listado de códigos vivos de toda la plataforma: cuenta propietaria, dominio de acceso y escaneos acumulados; las infracciones pueden retirarse |
| Supervisión operativa del negocio | Comunidad creativa | Revisión y recomendación de flujos de trabajo de la comunidad; recomendar otorga puntos al autor (reglas configurables) |
| Supervisión operativa del negocio | Comunidad de plantillas de vídeo | Si se muestran además las plantillas de la plataforma AIworkin (sincronización manual / programada, sincronizar ahora y último resultado) |
| Supervisión operativa del negocio | Gestión fiscal y contable | Pool de cuentas con API Key de declaración de Qixiangyun y emparejamiento de NIF, revisión de las solicitudes de habilitación de pago |
| Supervisión operativa del negocio | Configuración de GEO | Volumen semanal de la recolección automática GEO (previsto / real, detalle proyecto por proyecto) |
| Facturación y productos | Puntos y recarga | Tipo de cambio y tramos, recompensas de registro / invitación, límites de regalos y control de riesgo, tarifas y consumo por módulo (ya vienen precargadas las tarifas de insights IA / HRM / base de conocimiento / marketing / reclutamiento / revisión de habilidades), ajustes de cuenta y pedidos de recarga |
| Facturación y productos | Paquetes de servicio | Catálogo de paquetes oficiales de la plataforma (publicación por sección, precio en RMB + precio en puntos convertido con el tipo de cambio, ítems de entrega y opción entre «proveedor predefinido / asignación manual»; lo predefinido solo inicia la contratación, que sigue requiriendo confirmación del proveedor; límite de compra por empresa) y gestión de la entrega: cola de compras, emparejamiento de proveedores ítem a ítem, inicio de la contratación mediado por la plataforma, cambio de entidad y reembolso parcial o total |
| Facturación y productos | Plaza de modelos | Catálogo de modelos y canales upstream: publicación tomando el baseURL del canal, precios (unidad / tramos / precio de caché / descuento), libro de consumo y gateway compatible con OpenAI |
| Facturación y productos | Cuotas de derechos | Catálogo de derechos y cuotas por paquete: se configura el total, el ciclo (diario / mensual / anual) y la política al superarse por clave de función, con autorización ítem a ítem para empresas o proveedores y consulta de consumo |
| Capacidades y seguridad | Gobernanza de funciones | Interruptores del catálogo de funciones, lista negra de salida a red y límite duro del sandbox de Agent, libro de revisión de habilidades / plugins con aprobación manual, puerta de IA (interruptor global de la plataforma + sobrescritura por organización + límite por minuto de usuario × organización) |
| Capacidades y seguridad | Generar Skill | Se marcan dominios de negocio y acciones del MCP de este sistema y el modelo genera uno por uno paquetes de habilidad zip con `SKILL.md` en la raíz; tras descargarlos se pueden publicar en SkillHub para captar tráfico y el catálogo crece solo al crecer las interfaces MCP |
| Capacidades y seguridad | Revisión de publicaciones | Configuración del AccessKey de seguridad de contenido de Alibaba Cloud (guardado cifrado, solo se devuelve enmascarado) y región de acceso; publicar demandas y publicar servicios son escenarios obligatorios y los mensajes en comunidad y la publicación de currículos se activan según necesidad. Al habilitarlo, esas cuatro acciones de publicación se envían a revisión antes de guardarse y un block / review se rechaza directamente y queda en el libro de revisiones; si el upstream excede el tiempo o falla se permite el paso y se registra ERROR, sin bloquear la publicación normal |
| Capacidades y seguridad | Analítica de uso | Libro de eventos de página y de acción: volumen de eventos agregado por día, entidades únicas y Top de eventos, para analizar la utilización de las funciones y la retención |
| Capacidades y seguridad | Hardware inteligente | Catálogo de modelos de hardware, versiones del kit de desarrollo (subida de SDK / firmware y número de descargas) y herramientas API / MCP por defecto de cada modelo; los dispositivos que conecta el usuario y sus herramientas propias están en la sección «Hardware inteligente» del lado de usuario |
| Sistema y contenido | Versiones de términos | Gestión multiversión de términos de servicio / política de privacidad: cuerpo en editor enriquecido, fecha de efectos y reaceptación obligatoria; la aceptación del usuario guarda versión, hora e IP |
| Sistema y contenido | Registro de cambios | Changelog de producto: entradas de novedad / mejora / corrección mantenidas por versión, publicado en la pestaña «Registro de cambios» de `/help` |
| Sistema y contenido | Actualización de la plataforma | Obtiene el paquete desde un Release de GitHub o se sube manualmente a `update/`; el Agent de la plataforma compara la versión actual con el paquete y da riesgos y recomendaciones de ejecución; al confirmar se fuerza la copia de la base de datos y, por defecto, también del código, con rollback automático, y un ejecutor independiente instala / compila / migra / reinicia en modo mantenimiento; el libro de copias permite restaurar con un clic «base de datos completa + código» o «solo base de datos» |
| Sistema y contenido | Configuración del sistema | Almacenamiento de archivos (OSS) y libro de capacidad (ocupación, precios, migración por lotes de los activos históricos), clave de plataforma AIPDD, parámetros de plataforma, configuración del sitio y de la página de inicio (por pestañas, guardar surte efecto al instante; la configuración de inicio mantiene los textos, las imágenes y la visibilidad de las secciones de la landing del sitio) |

### 8. Servicios de modelo

- **Gestión de API Key**: dos juegos de claves gestionados por separado: las claves `ek_` de este sistema sirven para llamar a las interfaces abiertas (`/api/v1`) y a la plaza de modelos, y generar / copiar / restablecer / revocar se hace en esta página,
  pudiendo fijar en cada clave su propio «límite de puntos» (tope acumulado de consumo de las llamadas externas; al superarse se rechaza, o se deja sin límite);
  la AIPDD API Key (`sk-`) se vincula en la misma página y habilita capacidades upstream como la publicación sincronizada, la sincronización de datos de proveedores y los recursos de conexión. Las claves se guardan cifradas y solo su dueño puede copiarlas en cualquier momento desde esta página; nadie más las ve.
- **Plaza de modelos** (`/model-plaza`): catálogo de modelos disponibles publicados de forma unificada por la plataforma; las unidades de facturación coinciden con las de upstream (conversación / vectores por token, imágenes por unidad, vídeo y reconocimiento de voz por segundo, síntesis de voz por llamada),
  se puede probar en línea, consultar el libro de consumo y usar el gateway compatible con OpenAI con la clave `ek_`; el catálogo, los canales upstream y los precios los mantiene el panel en «Facturación y productos → Plaza de modelos».
  El panel añade la pestaña «Modelos por defecto»: fija el modelo por defecto de la plataforma para texto / visión / imagen / vídeo / reconocimiento de voz / síntesis de voz / vectores, con límites de puntos por llamada, diarios y mensuales y registro de los cambios;
  los usuarios con una recarga real acreditada heredan automáticamente las capacidades sin configurar (solo cuentan las órdenes de recarga pagadas; los regalos y los ajustes no) y las llamadas se descuentan de sus puntos al precio de catálogo.
- **API-MCP-Skill** (`/developer/api-mcp-skill`): acceso unificado a los servicios de modelo, con tres pestañas en este orden:
  **Skill**: listado de paquetes de habilidad generados por el administrador de plataforma por dominio de negocio (nombre, descripción, dominio, número de acciones cubiertas, modelo generador, fecha de actualización); pulsar «descargar» obtiene el zip;
  el paquete solo contiene instrucciones de llamada y ejemplos, nunca claves reales; volver a generar una habilidad con el mismo nombre reemplaza el paquete anterior y listado y descarga comparten el mismo interruptor de menú.
  **MCP Server**: Codex, Claude Desktop, Cursor, scripts propios y Workbuddy se conectan con la misma API Key;
  el servidor analiza primero la memoria de agente de esta cuenta y luego ejecuta automáticamente las acciones de este sitio según la autorización. El listado de interfaces se deriva de la capa de contrato, de modo que cada módulo nuevo (ERP compras-ventas-inventario, workbench de SEO, captación con IA, SCRM de WeCom, tareas de proyecto, HRM, etc.) entra solo en `list_operations` al entrar en el contrato;
  las acciones que tocan directamente el libro mayor —conclusiones de aprobación, cobros y pagos, movimientos de inventario (incluidas las aprobaciones de inventario / compras / entradas / gastos de ERP, la liquidación de cobros y pagos y los movimientos de entrada y salida)— están en la lista de exclusión permanente y solo pueden confirmarse por su dueño en la interfaz.
  **API**: el listado real de interfaces que este sistema expone hacia fuera, derivado de la capa de contrato y del mismo origen que el `list_operations` del servidor MCP y que la documentación OpenAPI.
  Las direcciones antiguas `/developer/docs` y `/developer/mcp` siguen redirigiendo, a `?view=api` y `?view=mcp` respectivamente.
- **Configuración de modelos**: la configuración compartida por Agent y creación de contenido: el canal integrado de AIPDD usa directamente la sk- Key y también se pueden conectar otras puertas compatibles con OpenAI y el MediaKit de Volcengine, eligiendo modelo por defecto para cada tipo;
  la parte alta de la página muestra la situación vigente de los «modelos por defecto de la plataforma» (si el usuario no ha configurado, se hereda según la elegancia de recarga) y el consumo de hoy / de este mes.
  El administrador de plataforma puede definir en «Plaza de modelos → Canales de usuario» el alcance de cada canal de cómputo (por defecto todos habilitados): los canales cerrados no pueden añadirse ni modificarse por el usuario ni seleccionarse;
  cerrar AIPDD solo detiene su cómputo (Configuración de modelos / Plaza de modelos), mientras que las demás funciones (servicios de negocio, etc.) siguen funcionando con la misma AIPDD API Key.
- **Mecanismos de plataforma**: acceso unificado a las capacidades transversales de §5.8 —Outbox de eventos y suscripciones Webhook (pruebas, registros de entrega, reenvío de fallos; el catálogo de eventos cubre tareas, proyectos, prospectos / pedidos / cobros de CRM, demandas externas, colaboraciones externas y otros nodos de negocio—, importación CSV (mapeo de campos, prueba previa, reutilización del mapeo) y exportación por módulo (los archivos exportados ya no reciben enlaces públicos permanentes: un endpoint autenticado revalida la organización actual y los devuelve), catálogo de informes, motor de reglas (coincidencia de condiciones + llamada a Webhook / notificación / insight / creación de tarea), compartidos públicos (contraseña, caducidad, desactivación; cada apertura revalida la inscripción de quien lo creó, de modo que su salida de la empresa o de la organización lo invalida), proveedores de identidad OIDC (prueba de descubrimiento, alta automática), política compartida de adjuntos, sincronización de contactos, asistencia y mensajes de tarjeta de Feishu / WeCom, registro de aceptación de términos (aviso global mientras no se acepte la versión nueva), analítica de uso del producto (eventos de página / acción y paneles agregados), conmutador de entidad (una misma persona cambia el alcance de HRM entre empresas / proveedores) y copiloto de percepción de página (acceso flotante en todo el sitio). Todas las pestañas de las páginas de negocio usan cápsulas con salto de línea (`PanelTabs` / `TabStrip`) y ya no se mezclan con los antd Tabs.
- **Centro de ayuda**: la base de conocimiento por capítulos de `/help` se versiona con el código (los archivos de conocimiento están en `backend/src/help`) y cubre el uso de cada módulo; la misma página tiene una pestaña «Registro de cambios» con el changelog de producto; el cuerpo del conocimiento se expone como tres acciones MCP de solo lectura `Help_chapters / Help_topic / Help_search`, así que basta con preguntar a Agent para obtener el uso oficial.
- **Instantánea OpenAPI**: `/api/openapi.json` (1947 operaciones), verificada en CI contra la instantánea del repositorio.

### 9. Hardware inteligente

La sección **Hardware inteligente** ocupa un grupo propio en la barra lateral (de primer nivel, situada tras los ajustes de gestión): el usuario explora el hardware y sus kits de desarrollo, conecta al plataforma los dispositivos que tiene y, según el tipo de hardware, llama a **herramientas exclusivas** vía MCP (control por Agent) y API (control por programa); el administrador de plataforma mantiene el catálogo de modelos, las versiones del kit y las herramientas por defecto de cada modelo.

- **Plaza de hardware** (`/hardware`): catálogo de modelos ordenado por recomendación / criterios, con especificaciones de cada modelo, versión del kit de desarrollo (canal estable / de vista previa) y descarga; los binarios del kit se suben directamente al OSS de este sitio, las descargas se cuentan y la página muestra el SHA-256 para verificarlo; entrando en el detalle del modelo se ven sus herramientas API / MCP por defecto.
- **Añadir hardware** (`/hardware/devices`): se elige el modelo y se conecta el dispositivo, generando un token de dispositivo con prefijo `hw_` (el texto en claro se muestra una única vez en el momento de generarlo y en la base solo se guarda su SHA-256); el dispositivo se da de alta por heartbeat una vez rellenados la dirección del servicio y el token en el SDK / firmware del kit, y el listado muestra tres estados —en línea / sin conexión / nunca reportado— (más de 180 segundos sin heartbeat pasa a sin conexión), con consulta por dispositivo del rastro de heartbeats / instrucciones / acuses para diagnosticar.
- **MCP de hardware** (`/hardware/mcp`): un servidor MCP de hardware independiente, `aiworkin-hardware-mcp` (endpoint `/api/v1/hardware/mcp`), totalmente separado del MCP de la plataforma: las herramientas solo vienen de la tabla de herramientas de hardware, se nombran `hw__<modelo>__<herramienta>` y se autentican con las claves `ek_` de «Desarrollador → API Key». Las herramientas de escritura pasan un triple umbral de autorización: si no están marcadas como «ejecutables automáticamente» en esta página, si vienen de una tarea programada sin supervisión o si el llamante declara dryRun, se devuelve únicamente un borrador y nunca se envía de verdad; la «prueba de llamada» del propio usuario no está sujeta a esta restricción.
- **API de hardware** (`/hardware/api`): las mismas herramientas se usan por el canal máquina `/api/v1/hardware/**` con la clave `ek_`, y basta `curl` para listarlas y llamarlas; los parámetros y las respuestas se rigen por los ejemplos JSON que muestra la propia página.
- **Kit de desarrollo (Dev Kit)**: el directorio raíz `hardware-devkit/` del repositorio aporta SDK y ejemplos listos para compilar: el componente ESP-IDF para ESP32, un paquete Python de solo biblioteca estándar para Jetson / Raspberry Pi, dos ejemplos ejecutables y un dispositivo simulado en Node sin dependencias (que permite cerrar el ciclo «heartbeat → obtener instrucción → acuse» sin hardware), además de la documentación del campo a campo del protocolo; el firmware precompilado se añadirá tras la primera compilación en dispositivos reales.
- **Mantenimiento en el panel**: la sección «Hardware inteligente» del administrador de plataforma se reparte en tres pestañas —«modelos de hardware / kits de desarrollo / herramientas por defecto»—: mantiene el catálogo de modelos, sube los kits de cada versión y define las herramientas API / MCP por defecto de cada modelo, con visibilidad inmediata del lado de usuario. Las herramientas creadas por el usuario solo son visibles y usables por él, no pasan a las herramientas por defecto del modelo y en esta primera versión tampoco se publican en el mercado.

Los canales de dispositivo (`/api/public/hardware/heartbeat`, `/commands` y `/result`) solo aceptan el token del dispositivo, no requieren inicio de sesión y **deliberadamente no los intercepta el interruptor de funciones**: si el administrador apaga la sección «Hardware inteligente», los heartbeats de los dispositivos ya conectados no se cortan.

### 10. Puntos y facturación

- **Puntos**: recarga por WeChat, regalos entre cuentas, tarifas por módulo y descuento por consumo (almacenamiento de activos digitales, CRM / BI / OA / atención al cliente IA), con movimientos y órdenes de recarga en una sola pantalla; ya están precargadas las tarifas de partidas como insights IA / HRM / base de conocimiento / marketing / reclutamiento / revisión de habilidades, que entran en vigor al publicarse el módulo correspondiente.
- **Base de almacenamiento**: los adjuntos y los activos digitales suben directamente al OSS de Alibaba Cloud de este sitio (sin retransición por el upstream); en la página de activos se puede borrar uno a uno y el panel «Configuración del sistema → Almacenamiento de archivos» muestra capacidad, precios y la migración por lotes de los activos históricos (interrumpible y reanudable, con reintento de fallos).
- **AWcoin**: solo lectura del saldo y del origen, **nunca canjeable de forma cruzada**.
- **Configuración en el panel**: tipo de cambio y tramos de recarga, recompensas de registro / invitación, límites de regalos y control de riesgo, tarifas módulo por módulo, ajustes de cuenta y consulta de pedidos.

### 11. Idiomas, sitio y notificaciones

- **8 idiomas de interfaz**: 简体中文 · English · Tiếng Việt · 日本語 · العربية · Français · Español · Русский;
  el administrador puede fijar el idioma por defecto del sitio, el visitante cambia cuando quiera y el árabe activa el RTL en todo el sitio.
- **Prioridad de tres niveles para el dominio del sitio**: panel «Configuración del sitio → Dominio del sitio》＞ `SITE_URL》＞ dirección actual del visitante;
  los endpoints de MCP / API, los callbacks de mensajería instantánea, el script de inserción de la atención al cliente, las entradas de códigos vivos y los enlaces de invitación se componen siempre con este orden (ver «Dominio del sitio» más abajo).
- **Visibilidad del menú**: cada entrada de la barra lateral del sitio (el acceso al cockpit y cada grupo, incluido el enlace externo «Plataforma de cómputo AIPDD») puede ocultarse una a una en el panel «Configuración del sitio → Visibilidad del menú de usuario»; si se ocultan todas las entradas de un grupo, el grupo desaparece solo (solo se oculta el menú, los enlaces siguen siendo accesibles).
- **Visibilidad de las pestañas de sección**: en las 12 páginas de secciones de «Servicios de negocio» (marketing / suministro y distribución / fiscal y contable / internacionalización / empleo flexible / logística / TI / propiedad intelectual / legal / consultoría estratégica / intercambio de activos / mercado de oferta y demanda), las pestañas «información de demandas» y «mercado de servicios» pueden ocultarse una a una por sección en el panel «Configuración del sitio → Pestañas de las secciones de servicios de negocio (marcar oculta)»; mismo criterio que la visibilidad del menú: se ocultan por igual a todas las identidades (administrador incluido) y solo controlan la visualización (los enlaces directos y las interfaces no se limitan).
- **Acceso al plugin de navegador en la cabecera**: el icono unificado de la barra superior, junto a las notificaciones y a la cuenta de servicio de WeChat, es el único acceso de descarga e instalación del cliente de plataforma (AIPDD Enterprise), compartido por la distribución de marketing, la captación con IA, el agente de navegador (Chrome local) y futuras operaciones de fichas de producto / SEO, por lo que ya no hay ventanas emergentes de «instalar plugin» dispersas. Al abrirlo hay cuatro pestañas: descarga e instalación (versión actual, versión mínima compatible, navegadores admitidos, instalador y pasos), instrucciones de uso (accesos de cada capacidad y preguntas frecuentes), registro de actualizaciones y sitios autorizados (ver y revocar los sitios en los que el plugin tiene confianza). Al abrirse se hace un saludo automático (sin botón de actualizar); si no está instalado se dan las instrucciones paso a paso y si la versión es demasiado antigua el icono muestra un punto de aviso y guía la actualización; si el navegador impide detectarlo puede confirmarse manualmente con «ya lo tengo instalado», aunque antes de ejecutar cualquier operación se vuelve a verificar el saludo de verdad. Si la plataforma aún no ha publicado el paquete del plugin o el administrador desactiva «Configuración del sitio → Acceso al plugin de navegador en la cabecera», el icono no se dibuja en absoluto; la dirección del instalador se compone con el dominio configurado del sitio y no fija ningún dominio de cliente.
- **Mensajes del sistema**: avisos centralizados de seis clases de eventos: atención al cliente, demandas y oportunidades, identidad y contratación, fiscal y declaraciones, automatización e integración y cuenta y plataforma.

---

## 🧱 Stack tecnológico y arquitectura

- **Backend**: [Hono 4](https://hono.dev) + `@hono/zod-openapi`, Prisma 5.22, MySQL 8 / PostgreSQL, Zod 4, Node.js ≥ 24
- **Frontend**: Next.js 16 (App Router) + React 19 + Ant Design 6 / Pro Components + `@tanstack/react-query` 5
- **Capa de contrato**: `packages/contracts` es la única fuente de verdad para frontend y backend, MCP y OpenAPI (1947 operaciones, códigos de error, catálogo MCP)
- **Autenticación**: sesiones SSO autoemitidas por este sitio (clave derivada por HKDF + comprobación de versión de cuenta) + claves `ek_` de las interfaces abiertas + claves `sk-` de AIPDD upstream, tres canales separados
- **Permisos sobre los datos**: los datos cuelgan siempre de la clave organizativa `(orgType, orgUserId)` y los listados / detalles / exportaciones / adjuntos / IA / tareas programadas revisan antes de consumir «cuenta inscrita + inscripción en la organización» (`HrmScopeService.isStanding`), de modo que la salida de la persona o el cambio de rol invalida el acceso al momento, sin depender de limpiezas asíncronas ni de la caché; los permisos de fila y columna de BI entran de hecho en la misma consulta, vista previa, gráfico y consulta con IA (filtrado de filas con marcadores `${userId}` / `${deptId}` y las columnas ocultas por permiso se eliminan del resultado y antes de alimentar al modelo); el contexto organizativo pasa solo por el servicio unificado de resolución de tenant (`TenantScopeService.preferred`), y CRM / BI / OA comparten con HRM / OKR el mismo criterio de «entidad actual»: si el conmutador superior de entidad está elegido y la relación sigue vigente se usa con preferencia y, tras cambiar, el alcance de los datos coincide en todos los módulos

```
Navegador ── Next.js (SSR/CSR, proxy inverso mismo origen /api/backend/*)
             │
             ├── API Hono (/api/backend negocio, /api/v1 interfaz abierta y MCP, /api/public endpoints públicos)
             │        ├── Cuentas / identidad / sesiones   ├── Workbench (CRM·BI·OA·OKR·RPA·tablas…)
             │        ├── Servicios de negocio, 11 líneas  ├── Social / reclutamiento / oferta y demanda
             │        ├── Puntos y base de almacenamiento OSS └── Consola de administración
             │        └── Canales upstream (AIPDD / AIworkin, clave de usuario o clave de plataforma)
             └── Prisma ── MySQL 8 / PostgreSQL (514 modelos, 52 migraciones)
```

## 📁 Estructura de directorios

```
oem-enterprise/
├── backend/                 # API Hono
│   ├── prisma/              # schema.prisma (514 modelos) + migrations/ (52) + seed
│   └── src/                 # 91 módulos de negocio
│       ├── http/ account/ identity/ auth/    # composición (routes.ts es la raíz de composición; rutas divididas por dominio en route-groups/), cuentas, identidad, sesiones
│       ├── aiworkin/ content/ agent-memory/  # canales upstream, Agent, creación de contenido y activos digitales
│       ├── ecom-pdp/ domestic-pdp/           # paquetes de imágenes de optimización de páginas de producto para comercio transfronterizo / nacional
│       ├── crm/ bi/ oa/ okr/ data-table/ rpa/ workbuddy/ livecode/ lowcode/
│       ├── social/ sns/ supply/ marketing/ logistics/ tax/ flex/ overseas/
│       ├── legal/ ip/ think-tank/ asset/ smart-service/                       # líneas de servicio de negocio
│       ├── points/ oss/ asset/               # facturación de puntos y almacenamiento
│       ├── mcp/ openapi/                     # interfaz abierta y servidor MCP
│       ├── hardware/                         # hardware inteligente (modelos / kits de desarrollo / dispositivos / herramientas / MCP de hardware independiente)
│       ├── admin/ platform/                  # consola de administración y ajustes del sitio
│       └── common/ shared/                   # adaptadores de dialecto, códigos de error, autenticación, credenciales upstream
├── frontend/                # aplicación Next.js (73 rutas de página, /social /admin, etc.)
├── packages/contracts/      # contratos compartidos frontend-backend, códigos de error, catálogo MCP
├── hardware-devkit/         # código fuente del kit de desarrollo de hardware inteligente (componente ESP-IDF / SDK de Python / ejemplos / simulador / documento de protocolo)
├── scripts/                 # scripts de instalación, migración, verificación y smoke
├── infra/                   # nginx / ejemplos de despliegue
└── docs/                    # diseño integral, snapshot de OpenAPI, línea base de rutas, capturas y recursos QR
```

El ensamblado HTTP del backend se reparte en dos niveles: `http/routes.ts` actúa solo como raíz de composición (llama a 27 funciones de registro por dominio) y las rutas concretas están en
`http/route-groups/` separadas por módulo (crm, okr, project, erp, hrm, oa, kb, data-table, marketing, scrm, admin…);
los tres grandes servicios de OKR, mecanismos de plataforma y proyectos se dividen igualmente por dominio en ficheros con una fachada fina: `okr.service.ts` / `mechanism.service.ts` /
`project.service.ts` solo conservan la delegación de los métodos públicos y la implementación real vive en los `*.base.ts` y en los servicios de cada funcionalidad del mismo directorio.

---

## 🚀 Inicio rápido (desarrollo local)

Requisitos previos: Node ≥ 24, pnpm ≥ 10 y una instancia accesible de **MySQL 8 o PostgreSQL** (se elige una).

### Opción A: instalación en un paso (recomendada, base de datos opcional)

```bash
pnpm install
pnpm setup            # interactivo: elige MySQL / PostgreSQL → introduce los datos de conexión → escribe backend/.env → genera el cliente → crea las tablas
# o no interactivo: pnpm setup --db postgres --host 127.0.0.1 --port 5432 --user app --password *** --database enterprise --yes
pnpm dev:api & pnpm dev:web
```

`pnpm setup` hace lo siguiente: ① escribe `DATABASE_URL` y `DB_PROVIDER` en `backend/.env`; ② en MySQL aplica el historial de migraciones con `prisma migrate deploy` y en PostgreSQL deriva `schema.postgres.prisma` desde `schema.prisma` y ejecuta `prisma db push`; ③ genera el Prisma Client para el dialecto elegido.

> El Client y las sentencias de creación de tablas de Prisma se generan por dialecto: al cambiar de base de datos vuelve a ejecutar `pnpm setup` (o `pnpm --filter aiworkin-enterprise-api prisma:generate:pg`).

### Opción B: configuración manual

```bash
# 1) Instalar dependencias (dispara prisma generate)
pnpm install

# 2) Configurar las variables de entorno del backend
cp backend/.env.example backend/.env
#   Edita backend/.env: define DATABASE_URL (MySQL o PostgreSQL), DB_PROVIDER, JWT_SECRET, EXTERNAL_CRED_KEY
#   (JWT_SECRET / EXTERNAL_CRED_KEY son cadenas aleatorias locales; si faltan, el backend se niega a arrancar)

# 3) Configurar las variables de entorno del frontend
cp frontend/.env.example frontend/.env.local

# 4) Inicializar la base de datos (migración / db push + generar cliente)
#   MySQL:
pnpm --filter aiworkin-enterprise-api prisma:migrate:deploy
pnpm --filter aiworkin-enterprise-api prisma:generate
#   PostgreSQL (usa el schema derivado):
pnpm --filter aiworkin-enterprise-api db:push:pg

# 4b) (opcional) Cargar datos de demostración: perfiles de empresa / directorio de proveedores / abogados·propiedad intelectual·empleo flexible / marketing de suministro, etc.
#     Solo para mostrar el directorio y los detalles; las identidades de demostración no son cuentas con las que se pueda iniciar sesión, así que tras entrar regístrate con una cuenta local como en el paso 5.
pnpm --filter aiworkin-enterprise-api prisma:seed

# 5) Arrancar el backend (por defecto 1690) y el frontend (por defecto 15890)
pnpm dev:api
pnpm dev:web
```

Abre en el navegador `http://127.0.0.1:15890` y registra una cuenta local para entrar en la red social y en la plaza de oferta y demanda.
El frontend enruta `/api/backend/*` al backend a través del lado servidor de Next.js, de modo que el navegador mantiene el mismo origen.

### Crear el administrador de la plataforma (obligatorio en el primer despliegue)

El administrador de la plataforma **no** se crea automáticamente con la instalación ni al arrancar; hay que crearlo explícitamente con `backend/scripts/seed-admin.ts` (idempotente, `--reset` restablece la contraseña):

```bash
# 1) Define ADMIN_USERNAME / ADMIN_PASSWORD en backend/.env
# 2) Ejecuta (crea la primera vez; si ya existe una cuenta con el mismo nombre, la omite)
pnpm --filter aiworkin-enterprise-api exec tsx scripts/seed-admin.ts
```

Después inicia sesión con esa cuenta y aparecerá el acceso al panel de la plataforma en la barra lateral; si no se crea, solo podrás registrar usuarios normales y no habrá forma de entrar en el panel de la plataforma.

### Variables de entorno clave

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Cadena de conexión: MySQL `mysql://user:pass@127.0.0.1:3306/enterprise` o PostgreSQL `postgresql://user:pass@127.0.0.1:5432/enterprise?schema=public` |
| `DB_PROVIDER` | `mysql` / `postgres`: base de la ramificación de dialecto del SQL nativo (autoincremento de números de documento, lectura de columnas JSON); si falta se deduce del protocolo de `DATABASE_URL` |
| `PORT` | Puerto de escucha del backend, por defecto `1690` |
| `JWT_SECRET` / `JWT_ISSUER` | Claves de firma de las sesiones locales; en producción hay que sustituirlas por valores aleatorios |
| `EXTERNAL_CRED_KEY` | Clave derivada AES-256-GCM para las claves de AIPDD y las credenciales de declaración externa; se configura aparte y no recurre a JWT_SECRET |
| `AIPDD_PLATFORM_KEY` | Respaldo de despliegue de la AIPDD APIKey de nivel plataforma (canal de datos base); tras guardarla en el panel «Configuración del sistema → Clave de plataforma AIPDD» manda el ciphertext de la base de datos |
| `AIWORKIN_BASE_URL` / `AIWORKIN_ENABLED` | Dirección del mercado upstream y su interruptor (al desactivarlo solo funciona el circuito cerrado local) |
| `CORS_ORIGIN_PATTERNS` | Orígenes permitidos de cross-origin (separados por comas) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Usuario y contraseña que lee el script `seed-admin` al crear el administrador de la plataforma (no se crea automáticamente al arrancar) |

> Todas las claves se guardan solo en el `.env` local (ya incluido en `.gitignore`) y ninguna interfaz devuelve jamás el texto en claro de una clave de AIPDD.

### Compatibilidad de bases de datos (MySQL / PostgreSQL)

Se elige una de las dos en la instalación y en ejecución manda `DB_PROVIDER` (si falta, se deduce del protocolo de `DATABASE_URL`); la lógica funciona de forma equivalente en ambas. Para absorber las diferencias de dialecto ya se ha hecho lo siguiente:

- **Fuente única del esquema**: se toma como referencia `prisma/schema.prisma` (MySQL) y, al instalar PostgreSQL, `scripts/gen-prisma-schema.mjs` deriva de forma determinista `schema.postgres.prisma` (`provider=postgresql`, `@db.TinyInt→@db.SmallInt`, `@db.DateTime→@db.Timestamp`). MySQL crea las tablas con el historial de migraciones y PostgreSQL con `prisma db push`.
- **Autoincremento de números de documento**: `document-number.ts` se ramifica por dialecto: MySQL usa `INSERT IGNORE` + `LAST_INSERT_ID` y PostgreSQL usa `ON CONFLICT DO NOTHING` + `UPDATE … RETURNING`.
- **Lectura de columnas JSON**: `jsonText()` de `common/sql-json.ts` genera la ruta `->>` según el dialecto (PostgreSQL `col->>'key'` / MySQL `col->>'$.key'`), que usan la extracción de grandes volúmenes de datos y las consultas de desduplicación entre tareas de la minería de prospectos.
- **Consultas y gráficos de BI**: `internalScope()` de `bi/bi.internal.ts` emite los marcadores según el dialecto (PostgreSQL `$1` / `ANY($2::text[])` / MySQL `?`); el entrecomillado de identificadores de `bi.query.service.ts` se elige según la base destinataria (comillas dobles en PG o acentos graves en MySQL en la base de la aplicación o en la fuente de datos externa).
- **Generación del cliente**: `postinstall` ejecuta `scripts/prisma-generate-auto.mjs`, que selecciona el esquema por defecto o el derivado según `DB_PROVIDER` / `DATABASE_URL` para que, al reinstalar dependencias, el cliente de PG no quede sobrescrito por el de MySQL.
- **Mayúsculas en los usuarios**: el acceso y las restricciones de unicidad unifican el criterio con **normalización a minúsculas** (la ordenación por defecto de MySQL no distingue mayúsculas y la de PostgreSQL sí); los correos también se guardan en minúsculas, con lo que el comportamiento de acceso y desduplicación es idéntico en ambas bases; las cuentas con mayúsculas mezcladas creadas antes del cambio siguen pudiendo acceder en MySQL (la CI lo cubre) y en bases existentes puede aplicarse una única vez `pnpm --filter aiworkin-enterprise-api db:normalize-usernames` (idempotente, válido en ambas bases; si hay colisión de nombres se omite y se lista el aviso).

> Diferencia conocida: la búsqueda en texto libre (palabras clave con `contains`) no distingue mayúsculas en MySQL y sí las distingue en PostgreSQL —`mode:'insensitive'` de Prisma no está soportado por el conector de MySQL, por lo que no se fuerza la unificación de todas las sentencias de búsqueda—. Los contenidos principales en chino no tienen mayúsculas y no se ven afectados; si quieres que también las búsquedas en alfabetos latinos se comporten igual, crea la base PostgreSQL con una ordenación ICU sensible a mayúsculas y minúsculas o normaliza a minúsculas los campos correspondientes antes de buscar.

---

## 🐳 Docker Compose (con MySQL)

El `docker-compose.yml` de la raíz orquesta **MySQL + backend + frontend**, tres servicios, pensado para probarlo en un clic:

```bash
# Las dependencias de todos los servicios ya traen valores de demostración locales (${VAR:-default}), así que basta con levantarlas directamente:
docker compose up --build
# Para personalizar credenciales / dominio, crea un .env en la raíz que sobrescriba MYSQL_* / JWT_SECRET / EXTERNAL_CRED_KEY, etc.
# Backend http://localhost:1690  Frontend http://localhost:15890
```

En el primer arranque el backend ejecuta automáticamente `prisma migrate deploy` para crear las tablas. Después hay que crear el administrador de la plataforma dentro del contenedor (compose ya inyecta
`ADMIN_USERNAME` / `ADMIN_PASSWORD`, con valores por defecto `admin` / `admin-Startup-2026`, sobrescribibles en el `.env` de la raíz):

```bash
docker compose exec api pnpm --filter aiworkin-enterprise-api exec tsx scripts/seed-admin.ts
```

En producción sustituye `JWT_SECRET` / `EXTERNAL_CRED_KEY`
por valores aleatorios fuertes y usa una base de datos y un proxy inverso independientes (`infra/nginx/` incluye configuraciones de ejemplo).

---

## 🌐 Dominio del sitio (dirección de acceso externa)

Nada en el sitio fija la dirección de la máquina: los endpoints de acceso de MCP / API, los callbacks de mensajería instantánea y los enlaces «gestionar» de las tarjetas, el script de inserción de la atención al cliente,
las entradas de códigos vivos, los enlaces de invitación, los valores sugeridos de callback de pago y demás direcciones absolutas se componen siempre con esta prioridad:

1. El valor escrito en «Panel de administración de la plataforma → Configuración del sitio → Dominio del sitio» (solo admite http/https, puede llevar puerto, se guarda y surte efecto sin reiniciar)
2. La variable de entorno del backend `SITE_URL`
3. La dirección desde la que accede el visitante (`window.location.origin`, con un solo dominio de despliegue no hace falta configurar nada)

En desarrollo local no hay que rellenar ninguno: en modo desarrollo Next hace de proxy inverso de `/api/*` y en producción Nginx captura primero `/api/*`,
así que endpoints como `https://tu-dominio/api/v1/mcp` funcionan en las dos formas.
Tras cambiar el dominio en el panel, ese dominio se añade solo a la lista blanca de CORS / validación de origen; cambiar el valor de la variable `SITE_URL` en sí sigue requiriendo reiniciar.

---

## 🔑 Vinculación de la AIPDD API Key y canales upstream

- El usuario vincula una API Key (sk-) emitida por la plataforma AIPDD en el bloque «Vinculación de AIPDD API Key» de la página «Servicios de modelo → Gestión de API Key»;
  varias cuentas pueden vincular la misma clave (N:1, agrupadas por huella) y el ciphertext se guarda en base con AES-256-GCM.
  La página independiente «Vinculación de AIPDD Key» (`/developer/aipdd`) se integró en Gestión de API Key y la dirección antigua redirige a `/developer/keys`.
  Estas dos páginas (Gestión de API Key / Configuración de modelos) son de autogestión a nivel de cuenta y **no se muestran en la barra lateral con la identidad de administrador de plataforma**; para configurarlas cambia a la identidad de empresa / persona física (la clave de nivel plataforma está en «Configuración del sistema → Clave de plataforma AIPDD»), aunque acceder al enlace directamente sigue funcionando.
- El mismo bloque sirve de guía de registro: cuando el administrador escribe el código recomendado de AIPDD en «Configuración del sitio», los usuarios nuevos siguen la guía para registrarse en www.aipdd.work e indicar ese código
  y reciben cómputo de regalo (la comisión por invitación va al administrador); las variables `AIPDD_REFERRAL_CODE` y `AIPDD_REGISTER_URL` fijan el código por defecto y sobrescriben la dirección de registro (solo admite http/https).
- `backend/src/common/upstream-token.ts` es la **única entrada de credenciales** para acceder al upstream: el código de negocio ya no usa el token de la sesión local como credencial upstream,
  sino que lo sustituye por la clave vinculada por el usuario; si no la ha vinculado, al disparar una acción upstream recibe un `403` orientativo (las publicaciones locales no se ven afectadas).
- **Los datos base usan la clave de plataforma, no la del usuario**: los diccionarios de provincias y ciudades y las opciones de diccionario de plataforma no dependen de la identidad del usuario, así que el administrador configura una clave de plataforma de forma unificada en
  «Panel de administración → Configuración del sistema → Clave de plataforma AIPDD» (con la misma validación de formato `sk-` y la verificación en línea,
  cifrada con AES-256-GCM en `system_settings.aipdd_platform_key`, devuelta solo enmascarada, con prioridad sobre la variable de entorno `AIPDD_PLATFORM_KEY`
  y aislada de lectura y escritura por la interfaz genérica de parámetros del sistema). Cadena de resolución: clave de plataforma → clave vinculada propia → si no hay ninguna, las regiones recurren al diccionario local de provincias y ciudades
  (`backend/src/shared/region-dictionary.ts`, con `GEO_CENTERS` como fuente), de modo que sin clave de plataforma configurada los formularios no se bloquean,
  aunque las opciones del diccionario de plataforma sí necesitan clave.
- **Las acciones de usuario** como publicar demandas, sincronizar con el upstream o conectar recursos **siguen usando la clave que haya vinculado cada cuenta**, sin que la clave de plataforma las afecte.
- Con `AIPDD_KEY_VERIFY=off` la vinculación no verifica en línea (útil para demostraciones sin conexión); en modo en línea se llama al upstream para validarla.

---

## 🧪 Compilación, pruebas y CI

Las pruebas unitarias del backend se ejecutan con `backend/test/jest-unit.json` (ts-jest), las pruebas de componentes del frontend usan Vitest + Testing Library (jsdom) y la CI comprueba además las plantillas de entorno, la instantánea OpenAPI, las subidas y las migraciones:

```bash
pnpm --filter aiworkin-enterprise-api test          # pruebas unitarias del backend (102 suites / 862 casos pasan, 15 se omiten según el entorno)
pnpm --filter aiworkin-enterprise-web test          # pruebas de componentes del frontend (libro de objetivos / desglose con IA / cliente 360 / proyecto 360)
pnpm test:uploads                                   # validación de subida de adjuntos e imágenes de facturas
pnpm test:environment                               # plantillas de despliegue y criterio de variables de entorno
pnpm api:docs:check                                 # comprueba que la instantánea OpenAPI coincide con la capa de contratos
pnpm lint                                           # estilo de código + formato prettier, umbral duro de CI
pnpm build                                          # contracts → backend tsc → frontend next build
```

- **Límite de heap de la compilación del frontend**: `build`, `typecheck` y `lint` pasan todos por `frontend/scripts/with-heap.mjs`, con
  `--max-old-space-size=10240` por defecto (el heap de ~4GB por defecto se queda corto al compilar en frío las 55 páginas o al ejecutar un lint con conciencia de tipos, y devuelve el código 134);
  puede sobrescribirse con `NODE_HEAP_MB` y se propaga si ya está configurado explícitamente.
- **CI (GitHub Actions)**: instalación de dependencias → compilación de contracts → base de arquitectura y rutas (`check-architecture`, incluida la comprobación de conexión directa de la puerta de IA) → plantillas de entorno →
  instantánea OpenAPI → typecheck → **umbral duro de estilo de código (`pnpm lint`, incluido el formato con prettier)** → pruebas unitarias del backend → pruebas de componentes del frontend → validación de subidas →
  **`prisma migrate deploy` sobre una base MySQL 8 vacía (0001→0052)** → compilación de frontend y backend.
- **Base de referencias de evasión de tipos**: `pnpm audit:escapes` genera `docs/escape-report.md` / `docs/escape-report.json`;
  `pnpm check:escape-budget` vigila con `.escape-budget.json` (el total y cada categoría solo pueden bajar) y `.escape-allowlist.json`
  (si la línea de una entrada registrada se desplaza, falla); ya está integrado en CI (después de la autoevaluación del instrumento y antes de los demás umbrales).
- **Criterio de fin de línea**: `backend/.prettierrc` fija `endOfLine: "auto"` y valida según el fin de línea que ya tenga cada fichero; en Windows
  `core.autocrlf=true` obtiene CRLF en el espacio de trabajo mientras el índice del repositorio y CI usan LF, así que ninguno de los dos lados da falsos positivos. Las demás reglas de formato son las por defecto de prettier.
- **Scripts de integración que dependen de la base de datos**: `pnpm test:regression` / `test:query-plans` / `test:performance` / `test:geo-recovery`
  van dirigidos a una base PostgreSQL local y vacía de una sola pasada (`createdb` + `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`),
  no son compatibles con el dialecto MySQL por defecto y se mantienen para ejecutarlos localmente cuando haga falta.
- **Scripts de humo** (PowerShell, ASCII puro, con usuario aleatorio para garantizar la idempotencia):

```powershell
pwsh scripts/smoke-m5.ps1   # circuito cerrado del módulo social (relaciones / publicaciones / grupos / mensajes privados / currículums / herencia de bloqueos)
pwsh scripts/smoke-m6.ps1   # plaza de oferta y demanda: publicación local sin Key + 403 al sincronizar upstream sin Key vinculada
pwsh scripts/smoke-site-url.ps1            # normalización del dominio del sitio / CORS / eco público + página 200
pwsh scripts/smoke-aipdd-platform-key.ps1  # clave AIPDD de plataforma: el ciphertext no se filtra + respaldo del diccionario de regiones
```

---

## 🧹 Recortes respecto a la edición comercial upstream

Esta edición open source es el resultado de «fusionar + desensibilizar + localizar» y **no incluye** explícitamente:

- el backend NestJS original del SNS y la identidad visual azul y blanca de aiworkin.com (se conserva la arquitectura de información y todos los estilos se reescribieron con AntD);
- los negocios con criptomonedas como las recompensas y la liquidación de awcoin (la plaza de oferta y demanda solo refleja el estado del upstream, sin cripto; AWcoin en el centro de puntos es solo lectura);
- mecanismos como la consulta y solicitud de claves `sk-` por cuenta del usuario desde la plataforma o la emisión local con `DEV_AUTO_LOGIN` (los datos de demostración se entregan con `prisma:seed`,
  pero esas identidades de demostración no permiten entrar con un clic: hay que registrarse con normalidad en local);
- el servicio Java de catálogo del upstream: la fuente de datos pasó a ser la tabla `users` local.

---

## 💬 Comunidad

Para unirte al grupo de discusión del sistema de trabajo empresarial con IA, solo tienes que escanear el código QR de abajo. Agradecemos que señoles errores y propongas mejoras: las buenas propuestas las implementamos y compartimos su código.

<div align="center">
<img src="docs/assets/wechat-group-qr.png" width="260" alt="Grupo de discusión del sistema de trabajo empresarial con IA · código QR de WeChat">
</div>

---

## 📄 Licencia

Publicado bajo la [Apache License 2.0](LICENSE).
