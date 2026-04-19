import CppRunner from './CppRunner.jsx'

const LINKED_LIST_SAMPLE = `#include <iostream>
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
`

const STL_SAMPLE = `#include <iostream>
#include <vector>
#include <algorithm>
#include <numeric>
using namespace std;

int main() {
    vector<int> v = {3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5};
    sort(v.begin(), v.end());

    int sum = accumulate(v.begin(), v.end(), 0);
    int maxv = *max_element(v.begin(), v.end());

    cout << "sorted: ";
    for (int x : v) cout << x << ' ';
    cout << "\\nsum = " << sum << ", max = " << maxv << endl;
    return 0;
}
`

export default function App() {
  return (
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
          de la programación.
        </p>
      </header>

      <article className="prose prose-invert prose-slate max-w-none prose-h2:text-slate-100 prose-a:text-fuchsia-400">
        <h2>¿Qué es una lista enlazada?</h2>
        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
          tempor incididunt ut labore et dolore magna aliqua. Una lista enlazada
          es una secuencia de nodos donde cada nodo apunta al siguiente. A
          diferencia de un arreglo, los nodos no viven en memoria contigua —
          viven donde el <code>new</code> decida ponerlos, y los links son los
          que imponen el orden.
        </p>

        <p>
          Abajo tenés una implementación minimalista de <code>LinkedList</code>{' '}
          con un método <code>push_front</code>. Léela, modifícala, y dale al
          botón Run para ver el output. Si querés la vista amplia con stdin y
          diagnósticos, expandí el widget con el icono <code>⤢</code>.
        </p>

        <CppRunner initialCode={LINKED_LIST_SAMPLE} />

        <h2>¿Por qué importan los punteros?</h2>
        <p>
          Cada nodo guarda un puntero <code>next</code> al siguiente nodo. Ese
          puntero es lo que nos permite recorrer la lista sin saber de antemano
          cuántos elementos hay. Ut enim ad minim veniam, quis nostrud
          exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
        </p>
        <p>
          Duis aute irure dolor in reprehenderit in voluptate velit esse cillum
          dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non
          proident, sunt in culpa qui officia deserunt mollit anim id est
          laborum.
        </p>

        <h2>STL al rescate</h2>
        <p>
          En la mayoría de los casos reales no vas a implementar tu propia lista
          — la biblioteca estándar ya te da <code>std::vector</code>,{' '}
          <code>std::list</code>, <code>std::deque</code> y más. Pero entender{' '}
          <em>cómo</em> funcionan por dentro es clave para saber cuál elegir.
        </p>

        <CppRunner initialCode={STL_SAMPLE} />

        <p>
          Sed ut perspiciatis unde omnis iste natus error sit voluptatem
          accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae
          ab illo inventore veritatis et quasi architecto beatae vitae dicta
          sunt explicabo.
        </p>
      </article>
    </main>
  )
}
