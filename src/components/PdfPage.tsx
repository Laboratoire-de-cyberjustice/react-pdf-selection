import React, { Component, createRef, CSSProperties, Fragment, RefObject } from "react";
import isEqual from "react-fast-compare";
import { Page } from "react-pdf";
import {
    BoundingRect,
    Coords,
    isAreaSelection,
    NormalizedAreaSelection,
    NormalizedPosition,
    SelectionType,
} from "../types";
import { getAbsoluteBoundingRectWithCSSProperties, getAreaAsPNG, getWindow } from "../utils";
import { getPositionWithCSSProperties, normalizePosition } from "../utils/coordinates";
import { AreaSelection, AreaSelectionProps } from "./AreaSelection";
import { NewAreaSelection, NewAreaSelectionProps } from "./NewAreaSelection";
import { PageLoader } from "./PageLoader";
import { PageDimension, PDFOrientation } from "./PdfViewer";
import { TextSelection, TextSelectionProps } from "./TextSelection";

export interface PdfPageProps<D extends object> {
    pageNumber: number;
    style: CSSProperties;
    innerRef: RefObject<HTMLDivElement>;
    areaSelectionActive: boolean;
    enableAreaSelection?: (event: React.MouseEvent) => boolean;
    pageDimensions?: PageDimension;
    selections?: SelectionType<D>[];
    onAreaSelectionStart?: (pageNumber: number) => void;
    onAreaSelectionChange?: (pageNumber: number) => void;
    onAreaSelectionEnd?: (selection: NormalizedAreaSelection) => void;
    textSelectionColor: string;
    textSelectionComponent?: (props: TextSelectionProps<D>) => JSX.Element;
    areaSelectionComponent?: (props: AreaSelectionProps<D>) => JSX.Element;
    newAreaSelectionComponent?: (props: NewAreaSelectionProps) => JSX.Element;
}

interface PdfPageState {
    renderComplete: boolean;
    areaSelection?: {
        originTarget?: HTMLElement;
        start?: Coords;
        position?: NormalizedPosition;
        moved?: boolean;
        locked?: boolean;
    };
}

export const getPageWidth = ({ orientation, height, width }: PageDimension) =>
    orientation === PDFOrientation.PORTRAIT ? width : height;

export const getPageHeight = ({ orientation, height, width }: PageDimension) =>
    orientation === PDFOrientation.PORTRAIT ? height : width;

export class PdfPage<D extends object> extends Component<PdfPageProps<D>, PdfPageState> {
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

    shouldComponentUpdate(nextProps: Readonly<PdfPageProps<D>>, nextState: Readonly<PdfPageState>) {
        return !isEqual(this.props, nextProps) || !isEqual(this.state, nextState);
    }

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
            areaSelection: { originTarget: event.target as HTMLElement, start, moved: false, locked: false },
        });
    };

    getAreaSelectionPosition = (event: MouseEvent) => {
        const { areaSelection } = this.state;
        if (!areaSelection || !areaSelection.originTarget || !areaSelection.start || areaSelection.locked) return;
        const end = this.containerCoords(event.pageX, event.pageY);
        if (!end) return;
        const { pageNumber, pageDimensions } = this.props;
        if (!pageDimensions) return;

        const pageBoundaries = {
            top: 0,
            left: 0,
            right: getPageWidth(pageDimensions),
            bottom: getPageHeight(pageDimensions),
        };
        const boundingRect = this.getBoundingRect(areaSelection.start, end, pageBoundaries);
        return normalizePosition(
            { boundingRect, rects: [boundingRect], pageNumber },
            { height: getPageHeight(pageDimensions), width: getPageWidth(pageDimensions) },
        );
    };

    onAreaSelectChange = (event: MouseEvent) => {
        const { areaSelection } = this.state;
        const position = this.getAreaSelectionPosition(event);
        if (!position) return;
        this.setState({ areaSelection: { ...areaSelection, moved: true, position } });
        this.props.onAreaSelectionChange?.(position.pageNumber);
    };

    onAreaSelectEnd = (event: MouseEvent) => {
        const { areaSelection } = this.state;
        if (!areaSelection?.moved) return;
        const { onAreaSelectionEnd } = this.props;
        const position = this.getAreaSelectionPosition(event);
        if (!position) return;
        // First childNode is the page canvas
        const canvas = this.inputRef.current?.childNodes[0];
        if (!canvas) return;
        const image = getAreaAsPNG(canvas as HTMLCanvasElement, position.absolute.boundingRect);
        onAreaSelectionEnd?.({ position, image });
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

    onTextLayerRender = () => {
        console.log("textLayerRendered");
        const textLayers = document.querySelectorAll(".react-pdf__Page__textContent");
        console.log(textLayers);

        textLayers.forEach((layer) => {
            const { style } = layer as HTMLElement;
            style.width = "100%";
            style.height = "100%";
            // style.setProperty("--scale-factor", "1");
        });
    };

    onPageRender = () => {
        if (this._mounted) this.setState({ renderComplete: true });
    };

    onMouseDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!this.props.enableAreaSelection?.(event)) return;
        document.addEventListener("pointermove", this.onMouseMove);
        document.addEventListener("pointerup", this.onMouseUp);
        this.onAreaSelectStart(event);
    };

    onMouseMove = (event: MouseEvent) => {
        this.onAreaSelectChange(event);
    };

    onMouseUp = (event: MouseEvent) => {
        document.removeEventListener("pointermove", this.onMouseMove);
        document.removeEventListener("pointerup", this.onMouseUp);
        this.onAreaSelectEnd(event);
    };

    renderSelections = () => {
        const { pageDimensions, selections, areaSelectionComponent, textSelectionComponent } = this.props;
        const AreaSelectionComponent = areaSelectionComponent ?? AreaSelection;
        const TextSelectionComponent = textSelectionComponent ?? TextSelection;
        if (!this.inputRef || !selections) return null;
        const selectionRenders = selections.map((selection, i) => {
            if (!pageDimensions) return null;
            const position = getPositionWithCSSProperties(selection.position, {
                height: getPageHeight(pageDimensions),
                width: getPageWidth(pageDimensions),
            });
            const normalizedSelection = { ...selection, position };
            return isAreaSelection(normalizedSelection) ? (
                areaSelectionComponent ? (
                    <Fragment key={i}>{areaSelectionComponent({ areaSelection: normalizedSelection })}</Fragment>
                ) : (
                    <AreaSelectionComponent key={i} areaSelection={normalizedSelection} />
                )
            ) : textSelectionComponent ? (
                <Fragment key={i}>{textSelectionComponent({ textSelection: normalizedSelection })}</Fragment>
            ) : (
                <TextSelectionComponent key={i} textSelection={normalizedSelection} />
            );
        });
        return <>{selectionRenders}</>;
    };

    render = () => {
        const { areaSelectionActive, pageDimensions, pageNumber, newAreaSelectionComponent } = this.props;
        const { areaSelection, renderComplete } = this.state;
        const NewAreaSelectionComponent = newAreaSelectionComponent ?? NewAreaSelection;
        const newAreaSelection = areaSelectionActive && areaSelection?.position && (
            <NewAreaSelectionComponent
                boundingRect={getAbsoluteBoundingRectWithCSSProperties(areaSelection.position.absolute.boundingRect)}
            />
        );
        console.log("page");
        return (
            <div
                ref={this.props.innerRef}
                // className="pdfViewer__page-container"
                style={{
                    // @ts-ignore-next-line A bit hacky, but it works to set a custom ::selection color programmatically
                    "--selection-color": this.props.textSelectionColor,
                    // "--scale-factor": "1.2 !important",
                    // width: "100%",
                    // height: "100%",
                    // ...(pageDimensions
                    //     ? {
                    //           width: `${getPageWidth(pageDimensions)}px`,
                    //           height: `${getPageHeight(pageDimensions)}px`,
                    //       }
                    //     : {}),
                    // ...this.props.style,
                }}
                onPointerDown={this.onMouseDown}
            >
                <Page
                    key={`page_${pageNumber}`}
                    pageNumber={pageNumber}
                    // width={pageDimensions ? getPageWidth(pageDimensions) : undefined}
                    // height={pageDimensions ? getPageHeight(pageDimensions) : undefined}
                    inputRef={this.inputRef}
                    loading={<PageLoader />}
                    onLoadSuccess={this.onPageLoad}
                    onRenderSuccess={this.onPageRender}
                    onRenderTextLayerSuccess={this.onTextLayerRender}
                >
                    {renderComplete && this.renderSelections()}
                    {newAreaSelection}
                </Page>
            </div>
        );
    };
}
