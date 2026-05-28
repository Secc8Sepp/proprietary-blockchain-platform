window.LayoutEngine = {
    draggedItem: null,
    draggedSection: null,

    init() {
        this.loadLayoutSettings();
        this.initResizers();
        this.initDraggableSidebars();
        this.initProfileDraggables();
        console.log('[INIT] Layout Engine ready.');
    },

    getDragAfterElement(container, y, selector) {
        if (!container) return null;
        const draggableElements = [...container.querySelectorAll(selector)];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    },

    initProfileDraggables() {
        document.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('profile-section') || e.target.classList.contains('playlist-item')) {
                if(window.viewingUserPublicKey !== window.CoreEngine.userKeys.publicKey) {
                    e.preventDefault();
                    return;
                }
                this.draggedSection = e.target;
                e.target.classList.add('dragging');
                e.target.style.opacity = 0.5;
            }
        });
        document.addEventListener('dragend', (e) => {
            if (e.target.classList.contains('profile-section') || e.target.classList.contains('playlist-item')) {
                e.target.style.opacity = "";
                e.target.classList.remove('dragging');
                this.draggedSection = null;
            }
        });
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (this.draggedSection) {
                if (this.draggedSection.classList.contains('profile-section')) {
                    const container = e.target.closest('.profile-sortable');
                    if (container) {
                        const afterElement = this.getDragAfterElement(container, e.clientY, '.profile-section:not(.dragging)');
                        if (afterElement == null) container.appendChild(this.draggedSection);
                        else container.insertBefore(this.draggedSection, afterElement);
                    }
                } else if (this.draggedSection.classList.contains('playlist-item')) {
                    const container = e.target.closest('#ui-profile-playlist');
                    if (container) {
                        const afterElement = this.getDragAfterElement(container, e.clientY, '.playlist-item:not(.dragging)');
                        if (afterElement == null) container.appendChild(this.draggedSection);
                        else container.insertBefore(this.draggedSection, afterElement);
                    }
                }
            }
        });
    },

    initResizers() {
        const leftResizer = document.getElementById('resizer-left');
        const rightResizer = document.getElementById('resizer-right');
        const leftSidebar = document.getElementById('side-nav-left');
        const rightSidebar = document.getElementById('side-nav-right');

        const createResizerHandler = (sidebar, resizer, direction) => {
            if (!sidebar || !resizer) return;
            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                resizer.classList.add('active');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';

                const mouseMoveHandler = (moveEvent) => {
                    let newWidth;
                    if (direction === 'left') {
                        newWidth = moveEvent.clientX;
                    } else { // right
                        newWidth = window.innerWidth - moveEvent.clientX;
                    }

                    if (newWidth < 50) { // Collapse threshold
                        sidebar.style.flexBasis = '0px';
                        sidebar.style.padding = '0';
                        sidebar.style.overflow = 'hidden';
                    } else if (newWidth > 600) { // Max width
                        sidebar.style.flexBasis = '600px';
                    } else {
                        sidebar.style.flexBasis = newWidth + 'px';
                        sidebar.style.padding = '10px';
                        sidebar.style.overflowY = 'auto';
                    }
                };

                const mouseUpHandler = () => {
                    resizer.classList.remove('active');
                    document.body.style.cursor = 'default';
                    document.body.style.userSelect = 'auto';
                    document.removeEventListener('mousemove', mouseMoveHandler);
                    document.removeEventListener('mouseup', mouseUpHandler);
                    this.saveLayoutSettings();
                };

                document.addEventListener('mousemove', mouseMoveHandler);
                document.addEventListener('mouseup', mouseUpHandler);
            });
        };

        createResizerHandler(leftSidebar, leftResizer, 'left');
        createResizerHandler(rightSidebar, rightResizer, 'right');
    },

    initDraggableSidebars() {
        const sidebars = document.querySelectorAll('.side-nav');
        sidebars.forEach(sidebar => {
            sidebar.addEventListener('dragstart', e => {
                if (e.target.classList.contains('side-card-header')) {
                    this.draggedItem = e.target.closest('.side-card');
                    if (this.draggedItem) {
                        setTimeout(() => this.draggedItem.classList.add('dragging'), 0);
                    }
                }
            });

            sidebar.addEventListener('dragend', () => {
                if (this.draggedItem) {
                    this.draggedItem.classList.remove('dragging');
                    this.draggedItem = null;
                    this.saveLayoutSettings();
                }
            });

            sidebar.addEventListener('dragover', e => {
                e.preventDefault();
                if (!this.draggedItem || !sidebar.contains(this.draggedItem)) return;
                
                const afterElement = this.getDragAfterElement(sidebar, e.clientY, '.side-card:not(.dragging)');
                if (afterElement == null) {
                    sidebar.appendChild(this.draggedItem);
                } else {
                    sidebar.insertBefore(this.draggedItem, afterElement);
                }
            });
        });
    },

    saveLayoutSettings() {
        const leftSidebar = document.getElementById('side-nav-left');
        const rightSidebar = document.getElementById('side-nav-right');
        if (leftSidebar) {
            localStorage.setItem('vod_layout_left_width', leftSidebar.style.flexBasis);
            const leftOrder = Array.from(leftSidebar.querySelectorAll('.side-card')).map(c => c.id);
            localStorage.setItem('vod_layout_left_order', JSON.stringify(leftOrder));
        }
        if (rightSidebar) {
            localStorage.setItem('vod_layout_right_width', rightSidebar.style.flexBasis);
            const rightOrder = Array.from(rightSidebar.querySelectorAll('.side-card')).map(c => c.id);
            localStorage.setItem('vod_layout_right_order', JSON.stringify(rightOrder));
        }
    },

    loadLayoutSettings() {
        const leftSidebar = document.getElementById('side-nav-left');
        const rightSidebar = document.getElementById('side-nav-right');

        const leftWidth = localStorage.getItem('vod_layout_left_width');
        if (leftSidebar && leftWidth) leftSidebar.style.flexBasis = leftWidth;
        const rightWidth = localStorage.getItem('vod_layout_right_width');
        if (rightSidebar && rightWidth) rightSidebar.style.flexBasis = rightWidth;

        const leftOrder = JSON.parse(localStorage.getItem('vod_layout_left_order') || 'null');
        if (leftSidebar && leftOrder) {
            leftOrder.forEach(cardId => {
                const card = document.getElementById(cardId);
                if (card) leftSidebar.appendChild(card);
            });
        }

        const rightOrder = JSON.parse(localStorage.getItem('vod_layout_right_order') || 'null');
        if (rightSidebar && rightOrder) {
            rightOrder.forEach(cardId => {
                const card = document.getElementById(cardId);
                if (card) rightSidebar.appendChild(card);
            });
        }
    }
};