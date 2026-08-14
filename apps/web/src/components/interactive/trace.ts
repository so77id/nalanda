// The generated program that photographs the heap, and the vocabulary it prints
// with. Kept apart from the component for the reason `harness.ts` gives: what
// runs in the browser is Java, and jsdom has none (ADR-0017), so both halves
// have to be testable without a JVM.

import { TRACE_CLASS } from '../../runtime';

export { TRACE_CLASS };

/** Prefix of the lines the tracer prints for the component, not for the reader. */
export const TRACE_MARK = '[nalanda] T ';

/**
 * How many photographs one run may take.
 *
 * Java runs on the page's main thread (ADR-0017), and a `// foto` written inside
 * a loop would otherwise emit a state per iteration — thousands of lines through
 * a launcher whose own output budget is 48kB, for a diagram nobody can step
 * through anyway. Over the cap the tracer stops recording and says so, which is
 * an authoring mistake reported as one rather than a frozen tab.
 */
export const MAX_STEPS = 40;

/**
 * How many objects one photograph may contain.
 *
 * Reachability is transitive: photographing the head of a 500-node list would
 * otherwise draw all 500. The cap is per step, and what it protects is
 * legibility as much as time — a diagram past a couple of dozen boxes has
 * stopped teaching.
 */
export const MAX_OBJECTS = 24;

/**
 * The tracer, compiled beside the snippet as the run's extra unit — the same
 * door `buildHarness` goes through.
 *
 * Three decisions are load-bearing here, and all three are what make the drawing
 * teach the right thing:
 *
 * 1. **`var` is overloaded per primitive type.** Overload resolution happens at
 *    compile time against the *static* type, so an `int` arrives as an `int` and
 *    can be drawn as a value in the box, while a `Punto` arrives as an `Object`
 *    and is drawn as an arrow. A single `Object` parameter would autobox the
 *    `int` and every primitive would become a heap object — erasing exactly the
 *    distinction document 2 §2 exists to teach.
 *
 * 2. **Identity, not equality.** Object ids come from `System.identityHashCode`
 *    through an `IdentityHashMap`, so two `String`s holding "hola" get two boxes
 *    and aliasing shows up as two names on one box. `equals` would merge them and
 *    the `==` lesson would draw its own counter-example.
 *
 * 3. **Ids are global, descriptions are per step.** The same object keeps its id
 *    across photographs so the reader can follow it, but its fields are re-read
 *    each time because that is the point of `b.x = 99`.
 *
 * Verified in Chromium on 2026-08-13 before any of this was written: reflection
 * works under CheerpJ — `getDeclaredFields` with `setAccessible(true)` reads
 * private fields by name, and cycles resolve by identity.
 */
export const TRACE_SOURCE = `import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;

public class ${TRACE_CLASS} {
    static final String MARK = "${TRACE_MARK}";

    static final IdentityHashMap<Object, Integer> IDS = new IdentityHashMap<Object, Integer>();
    static int siguienteId = 1;
    static int pasos = 0;
    static boolean desbordado = false;

    // Per step: what still has to be described, and what already was. Both are
    // identity-keyed — a cycle terminates because the node is the same object,
    // not because it looks like one.
    static List<Object> pendientes = new ArrayList<Object>();
    static IdentityHashMap<Object, Boolean> vistos = new IdentityHashMap<Object, Boolean>();
    static int objetos = 0;
    static boolean grabando = false;

    static int idDe(Object o) {
        Integer id = IDS.get(o);
        if (id == null) {
            id = Integer.valueOf(siguienteId++);
            IDS.put(o, id);
        }
        return id.intValue();
    }

    /** Newlines and backslashes would break the one-line-per-fact format. */
    static String esc(String s) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\\\') out.append("\\\\\\\\");
            else if (c == '\\n') out.append("\\\\n");
            else if (c == '\\r') out.append("\\\\r");
            else out.append(c);
        }
        return out.toString();
    }

    public static void inicio(int linea, String marco) {
        if (pasos >= ${MAX_STEPS}) {
            if (!desbordado) {
                desbordado = true;
                System.out.println(MARK + "TOPE pasos");
            }
            grabando = false;
            return;
        }
        pasos++;
        grabando = true;
        pendientes.clear();
        vistos.clear();
        objetos = 0;
        System.out.println(MARK + "PASO " + linea + " " + marco);
    }

    public static void var(String n, int v)     { if (grabando) System.out.println(MARK + "VAR " + n + " int " + v); }
    public static void var(String n, long v)    { if (grabando) System.out.println(MARK + "VAR " + n + " long " + v); }
    public static void var(String n, double v)  { if (grabando) System.out.println(MARK + "VAR " + n + " double " + v); }
    public static void var(String n, boolean v) { if (grabando) System.out.println(MARK + "VAR " + n + " boolean " + v); }
    public static void var(String n, char v)    { if (grabando) System.out.println(MARK + "VAR " + n + " char " + esc(String.valueOf(v))); }

    public static void var(String n, Object v) {
        if (!grabando) return;
        if (v == null) {
            System.out.println(MARK + "VAR " + n + " null 0");
            return;
        }
        System.out.println(MARK + "VAR " + n + " ref " + idDe(v));
        encolar(v);
    }

    static void encolar(Object o) {
        if (o == null || vistos.containsKey(o)) return;
        vistos.put(o, Boolean.TRUE);
        pendientes.add(o);
    }

    /** Emits one field or array element, queueing whatever it points at. */
    static void valor(String prefijo, String nombre, Class<?> tipo, Object v) {
        if (v == null) {
            System.out.println(MARK + prefijo + " " + nombre + " null 0");
        } else if (tipo.isPrimitive()) {
            System.out.println(MARK + prefijo + " " + nombre + " " + tipo.getName() + " " + esc(String.valueOf(v)));
        } else {
            System.out.println(MARK + prefijo + " " + nombre + " ref " + idDe(v));
            encolar(v);
        }
    }

    static void describir(Object o) {
        int id = idDe(o);

        if (o instanceof String) {
            // Not its char[]: two boxes both reading "hola" is what makes
            // new String("hola") == new String("hola") visible instead of claimed.
            System.out.println(MARK + "STR " + id + " " + esc((String) o));
            return;
        }

        Class<?> c = o.getClass();
        if (c.isArray()) {
            int n = Array.getLength(o);
            System.out.println(MARK + "ARR " + id + " " + c.getComponentType().getName() + " " + n);
            for (int i = 0; i < n; i++) {
                valor("ELM " + id, String.valueOf(i), c.getComponentType(), Array.get(o, i));
            }
            return;
        }

        System.out.println(MARK + "OBJ " + id + " " + c.getName());
        Field[] fs = c.getDeclaredFields();
        for (int i = 0; i < fs.length; i++) {
            Field f = fs[i];
            // Statics belong to the class, not to this box: without this every
            // Integer would drag MIN_VALUE, MAX_VALUE and its cache in with it.
            if (Modifier.isStatic(f.getModifiers())) continue;
            try {
                f.setAccessible(true);
                valor("FLD " + id, f.getName(), f.getType(), f.get(o));
            } catch (Throwable e) {
                System.out.println(MARK + "FLD " + id + " " + f.getName() + " oculto 0");
            }
        }
    }

    public static void fin() {
        if (!grabando) return;
        while (!pendientes.isEmpty()) {
            if (objetos >= ${MAX_OBJECTS}) {
                System.out.println(MARK + "TOPE objetos");
                break;
            }
            objetos++;
            describir(pendientes.remove(0));
        }
        System.out.println(MARK + "FINPASO");
    }

    /** Closes a frame the author opened, so it stops being drawn. */
    public static void finMarco(String marco) {
        System.out.println(MARK + "FINMARCO " + marco);
    }
}
`;
