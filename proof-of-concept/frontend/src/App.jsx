import { CodeEditor, LanguageProvider } from './widgets/code-editor/index.js'
import {
  LinkedListViz,
  StackViz,
  QueueViz,
  BSTViz,
  ArrayViz,
  GraphViz,
  HeapViz,
  HashMapViz,
} from './widgets/ds-visualizers/index.js'
import { Presentation } from './widgets/presentation/index.js'

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
      <Presentation
        subtitle="Nalanda · lección 01"
        title="Listas enlazadas"
        summary="Una primera mirada a una de las estructuras de datos más fundamentales de la programación. El selector de lenguaje arriba de cualquier widget cambia el lenguaje de toda la página a la vez."
      >
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

          <CodeEditor samples={LINKED_LIST} variant="exercise" />

          <h2>Stacks — el primo LIFO</h2>
          <p>
            Un stack es una lista restringida: solo podés agregar o quitar por{' '}
            <em>un</em> extremo, el <strong>top</strong>. El último que entró
            es el primero que sale (LIFO). Sed ut perspiciatis unde omnis iste
            natus error sit voluptatem accusantium doloremque.
          </p>

          <StackViz initialValues={[1, 2, 3]} />

          <h2>Queues — FIFO, como la cola del súper</h2>
          <p>
            El queue es el primo educado del stack: también restringimos el
            acceso, pero ahora por <em>dos</em> extremos distintos. Se agrega
            por atrás (<code>enqueue</code>) y se saca por adelante
            (<code>dequeue</code>). El primero que entra es el primero que
            sale — la misma lógica que una cola de supermercado.
          </p>

          <QueueViz initialValues={[10, 20, 30]} />

          <h2>Árboles — el salto a dos dimensiones</h2>
          <p>
            Hasta ahora todas nuestras estructuras eran <em>lineales</em>: una
            fila de nodos. El Binary Search Tree cambia la lógica: cada nodo
            puede tener hasta dos hijos, y la regla{' '}
            <strong>izquierda &lt; raíz &lt; derecha</strong> permite encontrar
            un valor en <code>O(log n)</code> si el árbol está balanceado. Probá
            insertar y borrar valores — fijate cómo se reacomodan los nodos al
            eliminar uno con dos hijos (el <em>sucesor in-order</em> ocupa su
            lugar).
          </p>

          <BSTViz />

          <h2>Recursión: Fibonacci</h2>
          <p>
            Otro patrón común: construir una secuencia iterativamente. Ut enim
            ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut
            aliquip ex ea commodo consequat.
          </p>

          <CodeEditor samples={FIBONACCI} variant="exercise" />

          <h2>Ordenar y agregar</h2>
          <p>
            En la mayoría de los casos reales no vas a implementar tu propia
            lista — la biblioteca estándar ya te da los bloques para ordenar,
            sumar, encontrar extremos. Duis aute irure dolor in reprehenderit in
            voluptate velit esse cillum dolore eu fugiat nulla pariatur.
          </p>

          <CodeEditor samples={SORT} variant="lab" />

          <h2>Arreglos — el índice como dirección</h2>
          <p>
            Un arreglo es el caso más directo: memoria contigua, acceso por
            índice en <code>O(1)</code>. Donde la lista enlazada paga con
            punteros la flexibilidad de crecer, el arreglo cobra al reubicar
            elementos cuando insertás en el medio. Probá empujar valores y
            acceder a un índice para ver cómo se resalta la celda.
          </p>

          <ArrayViz initialValues={[10, 42, 7, 5, 18]} capacity={10} />

          <h2>Grafos — relaciones entre nodos</h2>
          <p>
            Árboles y listas son casos especiales de grafos. Acá los nodos no
            tienen un orden impuesto: las aristas definen quién conoce a quién.
            El layout circular alcanza para intuiciones; para grafos grandes
            conviene un force layout.
          </p>

          <GraphViz
            nodes={[
              { id: 'A' },
              { id: 'B' },
              { id: 'C' },
              { id: 'D' },
              { id: 'E' },
              { id: 'F' },
            ]}
            edges={[
              { from: 'A', to: 'B', weight: 4 },
              { from: 'A', to: 'C', weight: 2 },
              { from: 'B', to: 'D', weight: 5 },
              { from: 'C', to: 'D', weight: 1 },
              { from: 'D', to: 'E', weight: 3 },
              { from: 'E', to: 'F', weight: 2 },
              { from: 'C', to: 'F', weight: 8 },
            ]}
            highlight={new Set(['A', 'C', 'D'])}
            directed
          />

          <h2>Heaps — el mejor siempre en la raíz</h2>
          <p>
            Un heap binario es un árbol completo con una invariante: cada nodo
            domina a sus hijos. En un <em>min-heap</em>, la raíz es el mínimo;
            en un <em>max-heap</em>, el máximo. Lo que se paga: una estructura
            parcialmente ordenada, no totalmente — pero eso alcanza para extraer
            el extremo en <code>O(log n)</code>.
          </p>

          <HeapViz initialValues={[1, 3, 6, 5, 9, 8, 7, 10, 12]} type="min" />

          <h2>Tablas hash — acceso directo por clave</h2>
          <p>
            Una función de hash convierte la clave en un índice. Si dos claves
            caen en el mismo bucket, resolvemos con <em>separate chaining</em>:
            cada bucket es una lista de entradas. En promedio, el acceso es
            <code> O(1)</code>. En el peor caso (todas las claves colisionan),
            es <code>O(n)</code>.
          </p>

          <HashMapViz
            size={7}
            buckets={[
              [],
              [{ key: 'ana', value: 28 }],
              [
                { key: 'luis', value: 31 },
                { key: 'eva', value: 24 },
              ],
              [],
              [{ key: 'pedro', value: 45 }],
              [],
              [
                { key: 'nico', value: 19 },
                { key: 'sara', value: 33 },
              ],
            ]}
            highlight="luis"
          />
      </Presentation>
    </LanguageProvider>
  )
}
