import { CodeRunner, LanguageProvider } from './widgets/code-runner/index.js'
import { LinkedListViz, StackViz } from './widgets/ds-visualizers/index.js'

const LINKED_LIST = {
  cpp: `#include <iostream>
#include <vector>
using namespace std;

struct Node {
    int value;
    Node* next;
    Node(int v) : value(v), next(nullptr) {}
};

struct LinkedList {
    Node* head = nullptr;

    void push_front(int v) {
        Node* n = new Node(v);
        n->next = head;
        head = n;
    }

    vector<int> to_vector() const {
        vector<int> out;
        for (Node* p = head; p != nullptr; p = p->next)
            out.push_back(p->value);
        return out;
    }
};

int main() {
    LinkedList list;
    for (int x : {5, 4, 3, 2, 1})
        list.push_front(x);

    cout << "list: ";
    auto v = list.to_vector();
    for (size_t i = 0; i < v.size(); ++i)
        cout << v[i] << (i + 1 < v.size() ? " -> " : "");
    cout << endl;

    int sum = 0;
    for (int x : v) sum += x;
    cout << "sum = " << sum << endl;
    return 0;
}
`,
  python: `class Node:
    def __init__(self, value):
        self.value = value
        self.next = None

class LinkedList:
    def __init__(self):
        self.head = None

    def push_front(self, v):
        n = Node(v)
        n.next = self.head
        self.head = n

    def to_list(self):
        out = []
        p = self.head
        while p is not None:
            out.append(p.value)
            p = p.next
        return out

lst = LinkedList()
for x in [5, 4, 3, 2, 1]:
    lst.push_front(x)

v = lst.to_list()
print("list:", " -> ".join(map(str, v)))
print("sum =", sum(v))
`,
}

const FIBONACCI = {
  cpp: `#include <iostream>
#include <vector>
using namespace std;

vector<int> fib(int n) {
    vector<int> out;
    int a = 0, b = 1;
    for (int i = 0; i < n; ++i) {
        out.push_back(a);
        int t = a + b;
        a = b;
        b = t;
    }
    return out;
}

int main() {
    auto seq = fib(10);
    cout << "fib(10) = ";
    for (int i = 0; i < (int)seq.size(); ++i)
        cout << seq[i] << (i + 1 < (int)seq.size() ? ", " : "");
    cout << "\\nsum = ";
    int s = 0;
    for (int x : seq) s += x;
    cout << s << endl;
    return 0;
}
`,
  python: `def fib(n):
    a, b = 0, 1
    out = []
    for _ in range(n):
        out.append(a)
        a, b = b, a + b
    return out

print("fib(10) =", fib(10))
print("sum =", sum(fib(10)))
`,
}

const SORT = {
  cpp: `#include <iostream>
#include <vector>
#include <algorithm>
#include <numeric>
using namespace std;

int main() {
    vector<int> v = {3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5};
    sort(v.begin(), v.end());

    cout << "sorted: ";
    for (int x : v) cout << x << ' ';
    cout << "\\nsum = " << accumulate(v.begin(), v.end(), 0);
    cout << ", max = " << *max_element(v.begin(), v.end()) << endl;
    return 0;
}
`,
  python: `v = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5]
v.sort()
print("sorted:", *v)
print(f"sum = {sum(v)}, max = {max(v)}")
`,
}

export default function App() {
  return (
    <LanguageProvider defaultLanguage="cpp">
      <main className="mx-auto max-w-3xl px-6 py-12 text-slate-200">
        <header className="mb-10">
          <p className="text-xs uppercase tracking-widest text-fuchsia-400">
            Nalanda · lección 01
          </p>
          <h1 className="mt-2 text-4xl font-semibold text-slate-100">
            Listas enlazadas
          </h1>
          <p className="mt-3 text-slate-400">
            Una primera mirada a una de las estructuras de datos más fundamentales
            de la programación. El selector de lenguaje arriba de cualquier widget
            cambia el lenguaje de <em>toda</em> la página a la vez.
          </p>
        </header>

        <article className="prose prose-invert prose-slate max-w-none prose-h2:text-slate-100 prose-a:text-fuchsia-400">
          <h2>¿Qué es una lista enlazada?</h2>
          <p>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
            eiusmod tempor incididunt ut labore et dolore magna aliqua. Una
            lista enlazada es una secuencia de nodos donde cada nodo apunta al
            siguiente. A diferencia de un arreglo, los nodos no viven en memoria
            contigua — viven donde el <code>new</code> decida ponerlos, y los
            links son los que imponen el orden.
          </p>

          <p>
            Antes de mirar código, jugá con la idea:{' '}
            <strong>probá agregar valores al frente y al final</strong>, y
            observá cómo cambia la cadena de links.
          </p>

          <LinkedListViz initialValues={[3, 1, 4]} />

          <p>
            Ahora el código. La implementación es minimalista:{' '}
            <code>push_front</code> crea un nodo nuevo que apunta al viejo head
            y pasa a ser el head. Podés cambiar el lenguaje en el selector
            para ver la misma idea en Python (donde los nodos son objetos por
            referencia, sin manejo explícito de memoria).
          </p>

          <CodeRunner samples={LINKED_LIST} />

          <h2>Stacks — el primo LIFO</h2>
          <p>
            Un stack es una lista restringida: solo podés agregar o quitar por{' '}
            <em>un</em> extremo, el <strong>top</strong>. El último que entró
            es el primero que sale (LIFO). Sed ut perspiciatis unde omnis iste
            natus error sit voluptatem accusantium doloremque.
          </p>

          <StackViz initialValues={[1, 2, 3]} />

          <h2>Recursión: Fibonacci</h2>
          <p>
            Otro patrón común: construir una secuencia iterativamente. Ut enim
            ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut
            aliquip ex ea commodo consequat.
          </p>

          <CodeRunner samples={FIBONACCI} />

          <h2>Ordenar y agregar</h2>
          <p>
            En la mayoría de los casos reales no vas a implementar tu propia
            lista — la biblioteca estándar ya te da los bloques para ordenar,
            sumar, encontrar extremos. Duis aute irure dolor in reprehenderit in
            voluptate velit esse cillum dolore eu fugiat nulla pariatur.
          </p>

          <CodeRunner samples={SORT} />
        </article>
      </main>
    </LanguageProvider>
  )
}
