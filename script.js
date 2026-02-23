document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('main-input');
    const category = document.getElementById('category-select');
    const label = document.getElementById('label-select');
    const addBtn = document.getElementById('add-btn');
    const container = document.getElementById('flow-container');
    const dateDisplay = document.getElementById('date-display');

    // Show current date
    dateDisplay.innerText = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

    let items = JSON.parse(localStorage.getItem('flowData')) || [];

    const render = () => {
        container.innerHTML = '';
        items.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'item-card';
            div.innerHTML = `
                <div>
                    <strong>${item.text}</strong>
                    <div>
                        <span class="tag">${item.cat}</span>
                        <span class="tag" style="background:#d1e7ff">${item.lab}</span>
                    </div>
                </div>
                <button onclick="deleteItem(${index})" style="background:none; color:red; border:none; cursor:pointer;">✕</button>
            `;
            container.appendChild(div);
        });
        localStorage.setItem('flowData', JSON.stringify(items));
    };

    addBtn.addEventListener('click', () => {
        if (!input.value) return;
        items.push({
            text: input.value,
            cat: category.value,
            lab: label.value,
            time: new Date().getTime()
        });
        input.value = '';
        render();
    });

    window.deleteItem = (index) => {
        items.splice(index, 1);
        render();
    };

    render();
});
