import React, {createRef, CSSProperties, PureComponent, Ref} from "react";
import {Page} from "react-pdf";
import {BoundingRect, NewAreaSelection, NormalizedAreaSelection, NormalizedPosition, SelectionType} from "../index";
import {getAreaAsPNG, getWindow} from "../utils";
import {normalizePosition} from "../utils/coordinates";
import {AreaSelection} from "./AreaSelection";
import {Coords, isAreaSelection} from "./PdfViewer";
import {TextSelection} from "./TextSelection";

interface PdfPageProps {
    innerRef: Ref<HTMLDivElement>;
    style: CSSProperties;
    pageDimensions?: { width: number; height: number };
    pageNumber: number;
    selections?: SelectionType[];
    areaSelectionActive: boolean;
    enableAreaSelection?: (event: React.MouseEvent) => boolean;
    onAreaSelectionStart?: (pageNumber: number) => void;
    onAreaSelectionEnd?: (selection: NormalizedAreaSelection) => void;
}

interface PdfPageState {
    renderComplete: boolean;
    areaSelection?: {
        originTarget?: HTMLElement;
        start?: Coords;
        position?: NormalizedPosition;
        locked?: boolean;
    };
}

export class PdfPage extends PureComponent<PdfPageProps, PdfPageState> {

    state: PdfPageState = {
        renderComplete: false,
    };
    inputRef = createRef<HTMLDivElement>();
    _mounted = false;

    componentDidMount = () => {
        this._mounted = true;
    };

    componentWillUnmount = () => {
        this._mounted = false;
    };

    containerCoords = (pageX: number, pageY: number) => {
        if (!this.inputRef.current) return;
        const pageBoundingBox = this.inputRef.current.getBoundingClientRect();
        const window = getWindow(this.inputRef.current);

        return {
            x: pageX - (pageBoundingBox.left + window.scrollX),
            y: pageY - (pageBoundingBox.top + window.scrollY),
        };
    };

    getBoundingRect(start: Coords, end: Coords, clip?: BoundingRect): BoundingRect {
        const clipRect = clip ?? {
            left: Number.MIN_SAFE_INTEGER,
            top: Number.MIN_SAFE_INTEGER,
            right: Number.MAX_SAFE_INTEGER,
            bottom: Number.MAX_SAFE_INTEGER,
        };
        return {
            left: Math.max(Math.min(end.x, start.x), clipRect.left),
            top: Math.max(Math.min(end.y, start.y), clipRect.top),
            right: Math.min(Math.max(end.x, start.x), clipRect.right),
            bottom: Math.min(Math.max(end.y, start.y), clipRect.bottom),
        };
    }

    onAreaSelectStart = (event: React.MouseEvent) => {
        this.props.onAreaSelectionStart?.(this.props.pageNumber);
        const start = this.containerCoords(event.pageX, event.pageY);
        if (!start) return;

        this.setState({
            areaSelection: { originTarget: event.target as HTMLElement, start, locked: false },
        });
    };

    getAreaSelectionPosition = (event: MouseEvent) => {
        const { areaSelection } = this.state;
        if (!areaSelection || !areaSelection.originTarget || !areaSelection.start || areaSelection.locked) return;
        const end = this.containerCoords(event.pageX, event.pageY);
        if (!end) return;
        if (!this.props.pageDimensions) return;

        const pageBoundaries = {
            top: 0,
            left: 0,
            right: this.props.pageDimensions.width,
            bottom: this.props.pageDimensions.height,
        };
        const boundingRect = this.getBoundingRect(areaSelection.start, end, pageBoundaries);
        return normalizePosition(
            { boundingRect, rects: [boundingRect], pageNumber: this.props.pageNumber },
            this.props.pageDimensions,
        );
    };

    onAreaSelectChange = (event: MouseEvent) => {
        const { areaSelection } = this.state;
        const position = this.getAreaSelectionPosition(event);
        if (!position) return;
        this.setState({ areaSelection: { ...areaSelection, position } });
    };

    onAreaSelectEnd = (event: MouseEvent) => {
        const { areaSelection } = this.state;
        const position = this.getAreaSelectionPosition(event);
        if (!position) return;
        // First childNode is the page canvas
        const canvas = this.inputRef.current?.childNodes[0];
        if (!canvas) return;
        const image = getAreaAsPNG(canvas as HTMLCanvasElement, position.absolute.boundingRect);
        this.props.onAreaSelectionEnd?.({ position, image });
        this.setState({
            areaSelection: { ...areaSelection, position, locked: true },
        });
    };

    onPageLoad = () => {
        const pageNode = this.inputRef.current;
        if (!pageNode) return;
        // Second childNode is the page textLayer div
        const { style } = pageNode.childNodes[1] as HTMLElement;
        style.top = "0";
        style.left = "0";
        style.transform = "";
    };

    onPageRender = () => {
        if (this._mounted)
            this.setState({ renderComplete: true });
    };

    onMouseDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!this.props.enableAreaSelection?.(event)) return;
        document.addEventListener("pointermove", this.onMouseMove);
        document.addEventListener("pointerup", this.onMouseUp);
        event.preventDefault();
        event.stopPropagation();
        this.onAreaSelectStart(event);
    };

    onMouseMove = (event: MouseEvent) => {
        event.stopPropagation();
        this.onAreaSelectChange(event);
    };

    onMouseUp = (event: MouseEvent) => {
        document.removeEventListener("pointermove", this.onMouseMove);
        document.removeEventListener("pointerup", this.onMouseUp);
        event.stopPropagation();
        this.onAreaSelectEnd(event);
    };

    renderSelections = () => {
        if (!this.inputRef || !this.props.selections) return null;
        const selectionRenders = this.props.selections.map((selection, i) => {
            if (!this.props.pageDimensions) return null;
            const normalizedSelection = {...selection, position: selection.position};
            return isAreaSelection(normalizedSelection) ? (
                <AreaSelection key={i} areaSelection={normalizedSelection} dimensions={this.props.pageDimensions} />
            ) : (
                <TextSelection key={i} textSelection={normalizedSelection} dimensions={this.props.pageDimensions} />
            );
        });
        return <>{selectionRenders}</>;
    };

    render = () => {
        return (
            <div style={this.props.style}>
                <div
                    ref={this.props.innerRef}
                    className="pdfViewer__page-container"
                    style={this.props.pageDimensions ? { width: `${this.props.pageDimensions.width}px` } : {}}
                    onPointerDown={this.onMouseDown}
                >
                    <Page
                        key={`page_${this.props.pageNumber}`}
                        pageNumber={this.props.pageNumber}
                        width={this.props.pageDimensions?.width}
                        height={this.props.pageDimensions?.height}
                        inputRef={this.inputRef}
                        onLoadSuccess={this.onPageLoad}
                        onRenderSuccess={this.onPageRender}
                    >
                        {this.state.renderComplete && this.renderSelections()}
                        {this.props.areaSelectionActive && this.state.areaSelection?.position && (
                            <NewAreaSelection
                                position={this.state.areaSelection.position}
                            />
                        )}
                    </Page>
                </div>
            </div>
        );
    };
}
