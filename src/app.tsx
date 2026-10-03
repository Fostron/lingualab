import { COURSES } from './content';
import { t } from './i18n';
import { useRoute } from './router';
import { selectCourse, useStore } from './store';
import { Icon, Loading } from './ui/common';
import { Dictionary, GrammarList, Home, Path, PracticeMenu, TopicView, UnitView, Welcome, WordPage } from './screens/Main';
import { SettingsPage, Stats } from './screens/Other';
import { Assessment, AssessmentReportPage } from './screens/Assessment';
import { ContinueLesson, LessonRun, Practice, Review } from './screens/Study';

const FULLSCREEN = new Set(['lesson', 'review', 'practice-run']);

export function App() {
  const st = useStore();
  const route = useRoute();
  const [head, a, b, extra] = route;

  if (head === 'courses' || (!st.info && !st.loading)) return <Shell nav={false}><Welcome /></Shell>;
  if (st.loading || (!st.course && !st.error)) return <Loading />;
  if (st.error || !st.course)
    return (
      <Shell nav={false}>
        <div class="page">
          <p class="warn">{st.error}</p>
          <button class="btn" onClick={() => void selectCourse(st.info!.id)}>
            ↻
          </button>
          <a class="btn" href="#/courses">
            {t().courseSwitch}
          </a>
        </div>
      </Shell>
    );
  const c = st.course;
  const tick = st.tick;
  const full = FULLSCREEN.has(head) || (head === 'practice' && !!a) || head === 'placement';

  let body;
  switch (head) {
    case undefined:
      body = <Home c={c} tick={tick} />;
      break;
    case 'path':
      body = <Path c={c} tick={tick} />;
      break;
    case 'unit':
      body = <UnitView c={c} unitId={a} tick={tick} />;
      break;
    case 'topic':
      body = <TopicView c={c} topicId={a} unitId={b} />;
      break;
    case 'lesson':
      body = <LessonRun key={`${a}-${b}-${extra || ''}`} c={c} unitId={a} slug={b} />;
      break;
    case 'continue':
    case 'learn':
      body = <ContinueLesson c={c} />;
      break;
    case 'review':
      body = <Review c={c} />;
      break;
    case 'test':
      body = <LessonRun key={`${a}-t`} c={c} unitId={a} slug="t" />;
      break;
    case 'placement':
      body = <Assessment c={c} />;
      break;
    case 'assessment':
      body = <AssessmentReportPage c={c} index={Number(a)} />;
      break;
    case 'grammar':
      body = <GrammarList c={c} tick={tick} />;
      break;
    case 'dict':
      body = <Dictionary c={c} tick={tick} />;
      break;
    case 'word':
      body = <WordPage c={c} id={Number(a)} tick={tick} />;
      break;
    case 'practice':
      body = a ? <Practice key={a} c={c} kind={a} /> : <PracticeMenu />;
      break;
    case 'stats':
      body = <Stats c={c} />;
      break;
    case 'settings':
      body = <SettingsPage c={c} />;
      break;
    default:
      body = <Home c={c} tick={tick} />;
  }
  return (
    <Shell nav={!full} active={head || 'home'}>
      {body}
    </Shell>
  );
}

function Shell({ nav, active, children }: { nav: boolean; active?: string; children: preact.ComponentChildren }) {
  const st = useStore();
  const info = st.info;
  const items: [string, string, string][] = [
    ['home', '#/', t().home],
    ['path', '#/path', t().path],
    ['practice', '#/practice', t().practice],
    ['grammar', '#/grammar', t().grammar],
    ['dict', '#/dict', t().dictionary],
    ['stats', '#/stats', t().stats],
  ];
  const icons: Record<string, string> = { home: 'home', path: 'path', practice: 'dumbbell', grammar: 'book', dict: 'search', stats: 'chart' };
  return (
    <div class={`shell ${nav ? 'with-nav' : ''}`}>
      {nav && (
        <header class="topbar">
          <a class="brand-sm" href="#/">
            <span class="logo">L</span>
            <span class="brand-name">LinguaLab</span>
          </a>
          <nav class="topnav">
            {items.map(([k, href, label]) => (
              <a class={active === k ? 'active' : ''} href={href}>
                {label}
              </a>
            ))}
          </nav>
          <div class="top-right">
            {info && (
              <a class="course-pill" href="#/courses" title={t().courseSwitch}>
                <Icon name="globe" size={16} /> {COURSES.find((x) => x.id === info.id)?.title}
                <small>{info.ui.toUpperCase()}</small>
              </a>
            )}
            <a class={`icon-btn ${active === 'settings' ? 'active' : ''}`} href="#/settings" title={t().settings}>
              <Icon name="gear" />
            </a>
          </div>
        </header>
      )}
      <main>{children}</main>
      {nav && (
        <nav class="bottomnav">
          {items.map(([k, href, label]) => (
            <a class={active === k ? 'active' : ''} href={href}>
              <Icon name={icons[k]} size={22} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
