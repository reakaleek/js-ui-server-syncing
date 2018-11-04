// @flow
import {Observable, Subject} from "rxjs";
import {Action, Store} from "redux";
import type {Entity, UUID} from "../model";
import {buffer, map, withLatestFrom} from "rxjs/operators";
import _ from "lodash";

/**
 * Basically, this class accepts an observable and an actionCreator.
 * Once the observable is emitted, the output of the observable is
 * taken and passed to the actionCreator, which in turn is dispatched
 * to the store. As long as the observable has not emitted yet, other
 * actions can be pushed into the action queue of the object.
 * As soon as the passed observable emits, the last action of the queue
 * is taken and merged with the ID of the output observable.
 * This action is then dispatched to the store.
 */
export class ActionPostponeObject {

    buffer$ = new Subject<number>();
    actionQueue$ = new Subject<Action>();

    constructor(
        deleteEntryCallback: () => void,
        store: Store,
        uuid: UUID,
        post$: Observable<Entity>,
        successActionCreator: (entity: Entity) => Action,
        entityIdentifier: string = 'payload'
    ) {
        this.deleteEntryCallback = deleteEntryCallback;
        this.store = store;
        this.uuid = uuid;
        this.post$ = post$;
        this.successActionCreator = successActionCreator;
        this.actionQueue$.asObservable()
            .pipe(
                buffer(this.buffer$),
                map(actions => _.last(actions)),
                withLatestFrom(this.buffer$),
                map(([action, id]) => {
                    if (action) {
                        return {
                            ...action,
                            [entityIdentifier]: {...action[entityIdentifier], id}
                        };
                    }
                    else {
                        return false;
                    }
                })
            )
            .subscribe(action => {
                if (action) {
                    this.store.dispatch(action);
                }
            });
        this._init();
    }

    _init = (): void => {
        this.post$.subscribe(entity => {
            this.store.dispatch(this.successActionCreator({...entity, uuid: this.uuid }));
            this.buffer$.next(entity.id);
            this.deleteEntryCallback();
        });
    };

    push = (action: Action) => {
        this.actionQueue$.next(action);
    }
}

/*
 * This class manages ActionPostponeObjects by storing them in a map.
 * Once the ActionPostponeObject is finished with its task, the entry
 * is deleted from the map again.
 * The UUID is used to assign follow-up actions to a running action.
 */
export class ActionProcrastinator {

    _uuidMap: {[UUID]: ActionPostponeObject} = {};

    constructor(store: Store) {
        this.store = store;
    }

    put = (
        uuid: UUID,
        obs$: Observable<Entity>,
        successActionCreator: (entity: Entity) => Action,
        entityIdentifier: string = 'payload'
    ): void => {
        if (!this.hasUUID(uuid)) {
            this._uuidMap[uuid] = new ActionPostponeObject(
                () => { this._remove(uuid) },
                this.store,
                uuid,
                obs$,
                successActionCreator,
                entityIdentifier
            );
        }
    };

    pushAction = (uuid: UUID, action: Action): void => {
        if (this.hasUUID(uuid)) {
            this._get(uuid).push(action);
        } else {
            throw Error(`Cannot find ActionPostponeObject with the UUID: ${uuid}`);
        }
    };

    hasUUID = (uuid: UUID): boolean => {
        return uuid in this._uuidMap;
    };

    _get = (uuid: UUID): ActionPostponeObject => {
        return this._uuidMap[uuid];
    };

    _remove = (uuid: UUID): void => {
        delete this._uuidMap[uuid];
    }
}

export default ActionProcrastinator;